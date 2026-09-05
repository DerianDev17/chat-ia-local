import { MODEL_ID } from './conversations.js';
import { getModel } from './models.js';

export async function checkCompatibility(environment = globalThis) {
  if (!environment.isSecureContext)
    return {
      supported: false,
      reason: 'Abre la aplicación con HTTPS o en localhost para usar la IA local.',
    };
  if (!environment.navigator.gpu)
    return {
      supported: false,
      reason:
        'Este navegador no ofrece WebGPU. Prueba un navegador compatible con aceleración de hardware activada.',
    };
  try {
    const adapter = await environment.navigator.gpu.requestAdapter();
    if (!adapter)
      return {
        supported: false,
        reason:
          'No encontramos una GPU compatible. Revisa la aceleración de hardware del navegador.',
      };
    return { supported: true };
  } catch {
    return {
      supported: false,
      reason:
        'No pudimos acceder a la GPU. Revisa la configuración del navegador y vuelve a intentarlo.',
    };
  }
}

const abortError = () => new DOMException('Operación cancelada', 'AbortError');
function bounded(promise, signal, timeout, description) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(description));
    }, timeout);
    const abort = () => {
      cleanup();
      reject(abortError());
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

export class LocalEngine {
  constructor() {
    this.ready = false;
    this.modelId = null;
  }

  async load(onProgress, modelId = MODEL_ID) {
    getModel(modelId);
    this.dispose();
    const operation = new AbortController();
    this.operation = operation;
    try {
      const { WebWorkerMLCEngine } = await bounded(
        import('@mlc-ai/web-llm'),
        operation.signal,
        60000,
        'No se pudo abrir el motor de IA.',
      );
      const worker = new Worker(new URL('../worker.js', import.meta.url), { type: 'module' });
      this.worker = worker;
      const workerFailure = new Promise((_, reject) => {
        worker.addEventListener(
          'error',
          () => reject(new Error('El motor local se ha detenido.')),
          { once: true },
        );
      });
      // Keep a rejection handler even when there is no active request.
      workerFailure.catch(() => {});
      this.workerFailure = workerFailure;
      this.engine = new WebWorkerMLCEngine(worker, {
        initProgressCallback: (info) => {
          if (!operation.signal.aborted) onProgress(info);
        },
      });
      await bounded(
        Promise.race([this.engine.reload(modelId, { context_window_size: 4096 }), workerFailure]),
        operation.signal,
        600000,
        'La descarga ha tardado demasiado. Comprueba tu conexión y vuelve a intentarlo.',
      );
      this.ready = true;
      this.modelId = modelId;
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  async *generate(messages) {
    if (!this.ready) throw new Error('Carga el modelo antes de enviar un mensaje.');
    const operation = new AbortController();
    this.operation = operation;
    this.stopped = false;
    try {
      const pending = this.engine.chat.completions.create({
        messages,
        stream: true,
        temperature: 0.7,
        max_tokens: 512,
      });
      const stream = await bounded(
        Promise.race([pending, this.workerFailure]),
        operation.signal,
        120000,
        'El modelo no ha respondido a tiempo.',
      );
      const iterator = stream[Symbol.asyncIterator]();
      while (true) {
        const next = await bounded(
          Promise.race([iterator.next(), this.workerFailure]),
          operation.signal,
          120000,
          'La generación se ha detenido. Vuelve a cargar el modelo.',
        );
        if (next.done) break;
        yield next.value;
      }
    } catch (error) {
      this.dispose();
      if (!this.stopped) throw error;
    } finally {
      clearTimeout(this.stopTimer);
    }
  }

  stop() {
    this.stopped = true;
    try {
      this.engine?.interruptGenerate();
    } catch {
      this.operation?.abort();
    }
    // Interrupt normally preserves the loaded model. A stuck worker is killed
    // after five seconds so the interface can always recover.
    this.stopTimer = setTimeout(() => this.operation?.abort(), 5000);
  }

  dispose() {
    clearTimeout(this.stopTimer);
    this.operation?.abort();
    this.worker?.terminate();
    this.worker = null;
    this.engine = null;
    this.ready = false;
    this.modelId = null;
  }
}
