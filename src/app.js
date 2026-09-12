import { MODELS, getModel, modelCache } from './models.js';
import {
  buildContext,
  branchConversation,
  contextDescription,
  duplicateConversation,
  exportMarkdown,
  newConversation,
  newMessage,
  recoverConversation,
  validatePrompt,
} from './conversations.js';
import { renderMarkdown } from './markdown.js';
import { readDocument, buildDocumentContext, citedSources } from './documents.js';
import { buildKnowledgeContext, projectName } from './knowledge.js';
import { createKnowledgeUI } from './knowledge-ui.js';
import { createConversationImportUI } from './conversation-import-ui.js';

export function createApp({
  runtime,
  cache = modelCache,
  store,
  checkCompatibility,
  document: doc = document,
  render = renderMarkdown,
  channel = null,
}) {
  const $ = (selector) => doc.querySelector(selector);
  const window = doc.defaultView;
  const syncChannel =
    channel ||
    (typeof window.BroadcastChannel === 'function'
      ? new window.BroadcastChannel('semilla-conversations')
      : null);
  const state = {
    conversations: [],
    current: null,
    busy: false,
    loading: false,
    initialized: false,
    supported: false,
    storageError: false,
    stopping: false,
    drafts: new Map(),
    attaching: false,
    cacheBusy: false,
    selectedModel: MODELS[0].id,
    focusMode: false,
  };
  try {
    state.selectedModel = getModel(window.localStorage.getItem('semilla-model') || MODELS[0].id).id;
    state.focusMode = window.localStorage.getItem('semilla-focus-mode') === 'true';
    const drafts = JSON.parse(window.localStorage.getItem('semilla-drafts') || '{}');
    if (drafts && typeof drafts === 'object')
      Object.entries(drafts).forEach(([id, text]) => {
        if (typeof text === 'string' && text.length <= 12000) state.drafts.set(id, text);
      });
  } catch {}
  let notice = '';
  let compatibilityFailureNotice = '';
  let saveTimer;
  let draftTimer;
  let pendingDocument = null;
  let previewDocument = null;
  let pendingEdit = null;
  let savingEdit = false;
  const conversationImport = createConversationImportUI({
    document: doc,
    store,
    locked: () => !state.initialized || state.busy || state.attaching,
    setLocked: (locked) => {
      state.attaching = locked;
      updateControls();
    },
    notice: showNotice,
    imported: (copy) => {
      state.conversations.push(copy);
      publishSync({ type: 'conversation-changed', id: copy.id, updatedAt: copy.updatedAt });
      $('#search').value = '';
      selectConversation(copy);
      showNotice('Conversación importada como copia. Ya puedes consultarla y continuar.');
      announce('Conversación importada.');
    },
  });
  const knowledgeUI = createKnowledgeUI({
    document: doc,
    store,
    current: () => state.current,
    locked: () => !state.initialized || state.busy || state.attaching,
    setLocked: (locked) => {
      state.attaching = locked;
      updateControls();
    },
    changed: () => publishSync({ type: 'knowledge-changed' }),
  });
  const announce = (text) => {
    $('#announcement').textContent = text;
  };

  function showNotice(text = '', kind = 'info') {
    notice = text;
    const storageWarning = state.storageError
      ? 'No se pudo guardar el historial. Tus cambios permanecen en esta pestaña; exporta una copia antes de cerrarla. '
      : '';
    $('#notice').textContent = storageWarning + notice;
    $('#notice').dataset.kind = kind;
    $('#notice').hidden = !storageWarning && !notice;
  }

  function setDraftStatus(text = '') {
    const status = $('#draft-status');
    if (!status) return;
    status.textContent = text;
    status.hidden = !text;
  }

  function persistDrafts() {
    try {
      const drafts = Object.fromEntries(
        [...state.drafts].filter(([, text]) => text).map(([id, text]) => [id, text]),
      );
      window.localStorage.setItem('semilla-drafts', JSON.stringify(drafts));
      setDraftStatus(Object.keys(drafts).length ? 'Borrador guardado' : '');
    } catch {
      setDraftStatus('No se pudo guardar el borrador');
    }
  }

  function scheduleDraftPersistence() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      draftTimer = null;
      persistDrafts();
    }, 250);
  }

  function rememberDraft(conversation) {
    if (!conversation) return;
    const text = $('#prompt').value;
    if (text) state.drafts.set(conversation.id, text);
    else {
      state.drafts.delete(conversation.id);
      setDraftStatus('');
    }
    scheduleDraftPersistence();
  }

  function clearDraft(id) {
    state.drafts.delete(id);
    scheduleDraftPersistence();
  }

  function flushDrafts() {
    clearTimeout(draftTimer);
    draftTimer = null;
    persistDrafts();
  }

  function publishSync(message) {
    try {
      syncChannel?.postMessage(message);
    } catch (error) {
      console.error('No se pudo sincronizar la conversación:', error);
    }
  }

  function removeLocalConversation(id) {
    const current = state.current?.id === id;
    clearDraft(id);
    state.conversations = state.conversations.filter((conversation) => conversation.id !== id);
    if (current && !state.busy) {
      state.current = newConversation();
      $('#prompt').value = '';
      renderConversation();
    }
    renderHistory();
  }

  function applyRemoteConversation(snapshot) {
    const incoming = recoverConversation(snapshot);
    const index = state.conversations.findIndex((conversation) => conversation.id === incoming.id);
    const existing = index < 0 ? null : state.conversations[index];
    if (existing && existing.updatedAt >= incoming.updatedAt) return false;
    if (state.busy && state.current?.id === incoming.id) return false;
    if (index < 0) state.conversations.push(incoming);
    else state.conversations[index] = incoming;
    if (state.current?.id === incoming.id) {
      state.current = incoming;
      renderConversation();
    }
    renderHistory();
    return true;
  }

  async function refreshConversation(id) {
    const latest = await store.get(id);
    if (latest) applyRemoteConversation(latest);
    else removeLocalConversation(id);
    return latest;
  }

  async function refreshAllConversations() {
    const currentId = state.current?.id;
    const conversations = (await store.list()).map(recoverConversation);
    state.conversations = conversations;
    const current = conversations.find((conversation) => conversation.id === currentId);
    if (!state.busy) {
      if (current) state.current = current;
      else {
        state.current = newConversation();
        $('#prompt').value = '';
      }
      renderConversation();
    }
    renderHistory();
  }

  async function receiveSync({ data }) {
    if (!data?.type || (state.busy && data.id === state.current?.id)) return;
    try {
      if (data.type === 'knowledge-changed') {
        if ($('#knowledge-dialog').open) await knowledgeUI.refresh();
      } else if (data.type === 'conversation-changed') {
        const latest = await store.get(data.id);
        if (latest && applyRemoteConversation(latest))
          showNotice('Esta conversación se actualizó en otra pestaña.');
      } else if (data.type === 'conversation-deleted') {
        const local = state.conversations.find((conversation) => conversation.id === data.id);
        if (!local || local.updatedAt <= data.updatedAt) {
          removeLocalConversation(data.id);
          showNotice('Una conversación se eliminó en otra pestaña.');
        }
      } else if (data.type === 'conversations-cleared') {
        await refreshAllConversations();
        showNotice('El historial se actualizó en otra pestaña.');
      }
    } catch (error) {
      console.error('No se pudo leer una actualización entre pestañas:', error);
    }
  }

  function updateControls() {
    $('#import-conversation').disabled = !state.initialized || state.busy || state.attaching;
    $('#open-knowledge').disabled = !state.initialized || state.busy || state.attaching;
    $('#chat-project').disabled = !state.initialized || state.busy || state.attaching;
    $('#use-knowledge').disabled = !state.initialized || state.busy || state.attaching;
    doc.querySelectorAll('[data-remember]').forEach((button) => {
      button.disabled = state.busy || state.attaching;
    });
    doc.querySelectorAll('[data-edit]').forEach((button) => {
      button.disabled = state.busy || state.loading || state.attaching || state.cacheBusy;
    });
    $('#open-parent').disabled = state.busy || state.attaching;
    const locked = state.busy || state.loading || state.attaching || state.cacheBusy;
    $('#manage-models').disabled = locked;
    $('#model-select').disabled = locked;
    $('#delete-model-cache').disabled = locked;
    $('#refresh-cache').disabled = locked;
    $('#unload-model').disabled = locked || !runtime.ready;
    $('#selected-model-name').textContent = getModel(state.selectedModel).name;

    $('#send').disabled =
      !state.initialized ||
      !runtime.ready ||
      state.cacheBusy ||
      state.busy ||
      state.attaching ||
      !$('#prompt').value.trim();
    $('#send').hidden = state.busy;
    $('#stop').hidden = !state.busy;
    $('#stop').disabled = state.stopping;
    $('#stop').textContent = state.stopping ? 'Deteniendo…' : '■ Detener';
    $('#new-chat').disabled = !state.initialized || state.busy || state.attaching;
    $('#conversation-options').disabled =
      (!state.current?.messages.length && !state.current?.document) ||
      state.busy ||
      state.attaching;
    $('#clear-data').disabled = state.busy || state.attaching || !state.initialized;
    $('#duplicate-chat').disabled =
      !state.initialized ||
      state.busy ||
      state.attaching ||
      (!state.current?.messages.length && !state.current?.document);
    $('#attach-document').disabled =
      !state.initialized || state.busy || state.attaching || !!state.current?.document;
    $('#remove-document').disabled = state.busy || state.attaching;
    $('#use-document').disabled = state.busy || state.attaching;
    $('#load-model').disabled =
      !state.supported || state.busy || state.cacheBusy || state.attaching;
    doc.querySelectorAll('.history-item').forEach((button) => {
      button.disabled = state.busy || state.attaching;
    });
    doc.querySelectorAll('[data-retry]').forEach((button) => {
      button.disabled = state.busy || state.loading || state.attaching || !state.supported;
    });
    const engineState = state.busy
      ? 'generating'
      : state.loading
        ? 'loading'
        : runtime.ready
          ? 'ready'
          : state.supported
            ? 'idle'
            : 'error';
    $('#engine-status').dataset.state = engineState;
    $('#status-text').textContent = {
      generating: 'Generando',
      loading: 'Cargando',
      ready: 'Listo',
      idle: 'Sin cargar',
      error: 'No compatible',
    }[engineState];
    $('#composer').setAttribute('aria-busy', String(state.busy));
  }

  function setFocusMode(enabled) {
    state.focusMode = enabled;
    $('.app').classList.toggle('focus-mode', enabled);
    $('#focus-mode').setAttribute('aria-pressed', String(enabled));
    $('#focus-mode').setAttribute(
      'aria-label',
      enabled ? 'Desactivar modo enfoque' : 'Activar modo enfoque',
    );
    $('#focus-mode').title = enabled
      ? 'Desactivar modo enfoque (Alt + F)'
      : 'Activar modo enfoque (Alt + F)';
    announce(enabled ? 'Modo enfoque activado.' : 'Modo enfoque desactivado.');
    try {
      window.localStorage.setItem('semilla-focus-mode', String(enabled));
    } catch {
      showNotice('El modo enfoque no se conservará al cerrar esta pestaña.');
    }
  }

  async function save(conversation = state.current) {
    if (
      !conversation ||
      (!conversation.messages.length &&
        !conversation.document &&
        !state.conversations.includes(conversation))
    )
      return;
    try {
      const saved = await store.save(conversation);
      if (saved === false) {
        await refreshConversation(conversation.id);
        showNotice(
          'Esta conversación cambió en otra pestaña. Se conservó la versión más reciente.',
          'error',
        );
        return false;
      }
      publishSync({
        type: 'conversation-changed',
        id: conversation.id,
        updatedAt: conversation.updatedAt,
      });
      if (state.storageError) {
        state.storageError = false;
        showNotice(notice);
      }
      return true;
    } catch (error) {
      console.error('No se pudo guardar la conversación:', error);
      state.storageError = true;
      showNotice(notice, 'error');
      return false;
    }
  }

  function renderHistory() {
    const search = $('#search').value.trim().toLocaleLowerCase('es');
    const conversations = [...state.conversations]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter(
        (conversation) =>
          conversation.title.toLocaleLowerCase('es').includes(search) ||
          conversation.messages.some((message) =>
            message.content.toLocaleLowerCase('es').includes(search),
          ),
      );
    $('#history').replaceChildren();
    if (!conversations.length) {
      const empty = doc.createElement('p');
      empty.className = 'history-empty';
      empty.textContent = search
        ? 'No encontramos conversaciones.'
        : 'Cada conversación, un nuevo comienzo.';
      $('#history').append(empty);
    }
    for (const conversation of conversations) {
      const button = doc.createElement('button');
      button.className = 'history-item';
      button.dataset.id = conversation.id;
      button.setAttribute('aria-current', String(conversation.id === state.current?.id));
      button.disabled = state.busy || state.attaching;
      const title = doc.createElement('strong');
      title.textContent = conversation.title;
      const time = doc.createElement('time');
      time.dateTime = new Date(conversation.updatedAt).toISOString();
      time.textContent = new Intl.DateTimeFormat('es', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(conversation.updatedAt);
      button.append(title, time);
      $('#history').append(button);
    }
  }

  function fillContent(element, message) {
    if (message.role === 'user') element.textContent = message.content;
    else {
      element.innerHTML = render(
        message.content ||
          (message.status === 'generating' ? 'Pensando…' : 'No se completó la respuesta.'),
      );
      element.querySelectorAll('a').forEach((link) => {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      });
      if (message.documentMode && message.status !== 'generating') {
        const sources = new Map(citedSources(message).map((source) => [source.id, source]));
        const walker = doc.createTreeWalker(element, window.NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) {
          if (!walker.currentNode.parentElement.closest('pre,code,a'))
            nodes.push(walker.currentNode);
        }
        for (const node of nodes) {
          const matches = [...node.textContent.matchAll(/\[(\d+)\]/g)];
          if (!matches.length) continue;
          const fragment = doc.createDocumentFragment();
          let offset = 0;
          for (const match of matches) {
            fragment.append(doc.createTextNode(node.textContent.slice(offset, match.index)));
            const valid = sources.has(Number(match[1]));
            const reference = doc.createElement(valid ? 'button' : 'span');
            reference.className = valid ? 'citation-button' : 'unverified-citation';
            reference.textContent = match[0];
            if (valid) {
              reference.type = 'button';
              reference.dataset.source = match[1];
              reference.dataset.message = message.id;
              reference.setAttribute('aria-label', `Abrir fragmento ${match[1]}`);
            } else reference.title = 'Referencia no disponible entre los fragmentos consultados';
            fragment.append(reference);
            offset = match.index + match[0].length;
          }
          fragment.append(doc.createTextNode(node.textContent.slice(offset)));
          node.replaceWith(fragment);
        }
      }
    }
  }

  function messageElement(message, index) {
    const item = doc.createElement('li');
    item.className = `message ${message.role}`;
    item.dataset.messageId = message.id;
    const header = doc.createElement('div');
    header.className = 'message-header';
    const avatar = doc.createElement('span');
    avatar.className = 'message-avatar';
    if (message.role === 'user') avatar.textContent = 'T';
    else {
      const symbol = doc.createElement('img');
      symbol.src = new URL('../assets/brand/symbol.svg', import.meta.url).href;
      symbol.alt = '';
      symbol.width = 28;
      symbol.height = 28;
      avatar.append(symbol);
    }
    avatar.setAttribute('aria-hidden', 'true');
    header.append(avatar, doc.createTextNode(message.role === 'user' ? 'Tú' : 'Semilla Digital'));
    const content = doc.createElement('div');
    content.className = 'message-content';
    fillContent(content, message);
    item.append(header, content);
    if (message.role === 'user') {
      const edit = doc.createElement('button');
      edit.className = 'text-button';
      edit.textContent = 'Editar en una versión';
      edit.dataset.edit = message.id;
      item.append(edit);
    }
    if (message.content && message.status === 'complete') {
      const remember = doc.createElement('button');
      remember.className = 'text-button';
      remember.textContent = 'Recordar esto';
      remember.dataset.remember = message.id;
      item.append(remember);
    }
    if (message.sources?.length && message.status !== 'generating') {
      const references = doc.createElement('div');
      references.className = 'source-list';
      const label = doc.createElement('span');
      label.textContent = 'Fragmentos consultados:';
      references.append(label);
      for (const source of message.sources) {
        const button = doc.createElement('button');
        button.className = 'text-button';
        button.textContent = `[${source.id}] ${source.name}${source.page ? ` · Página ${source.page}` : ''}`;
        button.dataset.source = String(source.id);
        button.dataset.message = message.id;
        references.append(button);
      }
      item.append(references);
    }
    if (message.role === 'assistant') {
      const actions = doc.createElement('div');
      actions.className = 'message-actions';
      if (message.content) {
        const copy = doc.createElement('button');
        copy.className = 'text-button';
        copy.dataset.copy = message.id;
        copy.textContent = 'Copiar';
        actions.append(copy);
      }
      if (message.status !== 'generating' && index === state.current.messages.length - 1) {
        const retry = doc.createElement('button');
        retry.className = 'text-button';
        retry.dataset.retry = message.id;
        retry.disabled = state.busy || state.loading || !state.supported;
        retry.textContent = message.status === 'complete' ? 'Volver a generar' : 'Reintentar';
        actions.append(retry);
      }
      if (message.status !== 'complete') {
        const status = doc.createElement('span');
        status.className = 'message-state';
        status.textContent = {
          generating: 'Escribiendo…',
          interrupted: 'Respuesta interrumpida',
          error: 'No se pudo completar',
        }[message.status];
        actions.append(status);
      } else if (message.finishReason === 'length') {
        const status = doc.createElement('span');
        status.className = 'message-state';
        status.textContent = 'Límite de longitud alcanzado';
        actions.append(status);
      }
      item.append(actions);
    }
    return item;
  }

  function renderConversation() {
    $('#chat-project').value = projectName(state.current?.project);
    $('#use-knowledge').checked = state.current?.useKnowledge === true;
    $('#chat-title').textContent = state.current?.title || 'Nueva conversación';
    const branch = state.current?.branch;
    $('#branch-info').hidden = !branch;
    $('#branch-description').textContent = branch
      ? `Versión de «${branch.parentTitle}» · Pregunta ${Math.floor(branch.messageIndex / 2) + 1}. Contexto al crear: ${branch.context}.`
      : '';
    $('#open-parent').hidden = !state.conversations.some((entry) => entry.id === branch?.parentId);
    const messages = state.current?.messages || [];
    $('#welcome').hidden = messages.length > 0;
    $('#messages').hidden = !messages.length;
    $('#messages').replaceChildren(...messages.map(messageElement));
    renderDocument();
    updateControls();
  }

  function scrollToEnd() {
    $('#chat-scroll').scrollTop = $('#chat-scroll').scrollHeight;
  }
  function isNearEnd() {
    const el = $('#chat-scroll');
    return el.scrollHeight - el.scrollTop - el.clientHeight < 110;
  }
  function resizePrompt() {
    $('#prompt').style.height = 'auto';
    $('#prompt').style.height = `${Math.min($('#prompt').scrollHeight, 150)}px`;
    updateControls();
  }

  const mobile = window.matchMedia('(max-width: 760px)');
  function sidebar(open, returnFocus = true) {
    $('#sidebar').classList.toggle('is-open', open);
    $('#sidebar-backdrop').hidden = !open || !mobile.matches;
    $('#open-sidebar').setAttribute('aria-expanded', String(open));
    $('#sidebar').inert = mobile.matches && !open;
    $('.workspace').inert = mobile.matches && open;
    if (open && mobile.matches) $('#close-sidebar').focus();
    else if (returnFocus && mobile.matches) $('#open-sidebar').focus();
  }

  function selectConversation(conversation) {
    if (state.busy || state.attaching) return;
    if (state.current) rememberDraft(state.current);
    state.current = conversation;
    const draft = state.drafts.get(conversation.id) || '';
    $('#prompt').value = draft;
    setDraftStatus(draft ? 'Borrador recuperado' : '');
    showNotice();
    renderConversation();
    renderHistory();
    resizePrompt();
    sidebar(false, false);
    if (conversation.messages.length) scrollToEnd();
    else $('#chat-scroll').scrollTop = 0;
    $('#prompt').focus();
  }

  function unloadModel() {
    runtime.dispose();
    $('#model-card').hidden = false;
    $('#model-title').textContent = `Prepara ${getModel(state.selectedModel).name}`;
    $('#model-description').textContent =
      'Carga el modelo para continuar. Las descargas guardadas se reutilizarán cuando estén disponibles.';
    updateControls();
  }

  async function refreshCache() {
    if (state.cacheBusy) return;
    state.cacheBusy = true;
    updateControls();
    $('#model-spec').textContent = getModel(state.selectedModel).detail;
    $('#cache-status').textContent = 'Comprobando caché…';
    $('#storage-usage').textContent = '';
    try {
      const present = await cache.status(state.selectedModel);
      $('#cache-status').textContent = present
        ? 'Caché detectada. La carga verificará los archivos necesarios.'
        : 'No se detectó caché de este modelo.';
      const estimate = await window.navigator.storage?.estimate?.();
      if (estimate?.usage !== undefined)
        $('#storage-usage').textContent =
          `Todo el sitio: ${(estimate.usage / 1048576).toFixed(1)} MB usados${estimate.quota ? ` de ${(estimate.quota / 1073741824).toFixed(1)} GB disponibles como cuota` : ''}. Incluye historial, documentos y modelos.`;
    } catch {
      $('#cache-status').textContent =
        'No se pudo consultar el almacenamiento. Puedes volver a intentarlo.';
    } finally {
      state.cacheBusy = false;
      updateControls();
    }
  }

  async function deleteModelCache() {
    if (state.busy || state.loading || state.attaching || state.cacheBusy) return;
    const id = state.selectedModel;
    const confirmed = confirmDeletion(false);
    $('#confirm-title').textContent = `¿Borrar caché de ${getModel(id).name}?`;
    $('#confirm-description').textContent =
      'Se liberará la memoria del modelo y se borrarán sus descargas. Necesitarás internet para volver a cargarlo. Tus conversaciones y documentos se conservan.';
    if (!(await confirmed)) return;
    if (state.busy || state.loading || state.cacheBusy) return;
    state.cacheBusy = true;
    unloadModel();
    try {
      await cache.remove(id);
      $('#cache-status').textContent =
        'Caché eliminada. El modelo se descargará en la próxima carga.';
      $('#storage-usage').textContent = '';
    } catch {
      $('#cache-status').textContent = 'No se pudo borrar toda la caché. Vuelve a intentarlo.';
    } finally {
      state.cacheBusy = false;
      updateControls();
    }
  }

  async function loadModel() {
    if (state.loading || state.busy || state.attaching || state.cacheBusy || !state.supported)
      return false;
    state.loading = true;
    showNotice();
    $('#model-card').hidden = false;
    $('#model-title').textContent = `Preparando ${getModel(state.selectedModel).name}`;
    $('#model-description').textContent =
      'La primera descarga puede tardar varios minutos. Puedes escribir mientras esperas.';
    $('#load-model').textContent = 'Cancelar';
    $('#load-progress').value = 0;
    $('#load-progress').hidden = false;
    $('#load-detail').hidden = false;
    $('#load-detail').textContent = 'Conectando con el modelo…';
    updateControls();
    try {
      await runtime.load((info) => {
        $('#load-progress').value = Math.max(0, Math.min(1, info.progress));
        $('#load-detail').textContent = `Preparando modelo · ${Math.round(info.progress * 100)} %`;
      }, state.selectedModel);
      $('#model-card').hidden = true;
      announce('Modelo listo. Ya puedes enviar tu mensaje.');
      return true;
    } catch (error) {
      $('#model-title').textContent =
        error.name === 'AbortError' ? 'Carga cancelada' : 'No se pudo cargar el modelo';
      $('#model-description').textContent =
        error.name === 'AbortError'
          ? 'Puedes volver a cargarlo cuando quieras.'
          : 'Comprueba la conexión y la memoria disponible. Cierra otras pestañas y vuelve a intentarlo.';
      if (error.name !== 'AbortError') console.error('Carga del modelo:', error);
      return false;
    } finally {
      state.loading = false;
      $('#load-model').textContent = 'Cargar modelo';
      $('#load-progress').hidden = true;
      $('#load-detail').hidden = true;
      updateControls();
    }
  }

  async function prepareContext(question, history = state.current.messages) {
    const conversation = state.current;
    if (conversation.document && conversation.useDocument !== false)
      return buildDocumentContext(
        question,
        conversation.document,
        conversation.documentPage || null,
        { history },
      );
    if (!conversation.useKnowledge) return null;
    return buildKnowledgeContext(
      question,
      await store.listKnowledge(),
      conversation.project,
      history,
    );
  }

  async function generate(reply, documentContext = null) {
    const conversation = state.current;
    const context = documentContext || buildContext(conversation.messages);
    state.busy = true;
    state.stopping = false;
    showNotice(
      documentContext
        ? context.kind === 'knowledge'
          ? `Biblioteca y memoria de ${projectName(conversation.project)}: ${context.sources.length} fragmentos consultados. La búsqueda usa palabras; las referencias no garantizan exactitud.${context.summary && context.partial ? ' El resumen es parcial.' : ''}`
          : `Consulta del documento: ${context.sources.length} de ${conversation.document.chunks.length} fragmentos. ${context.summary && context.partial ? 'El resumen será parcial. ' : ''}La selección usa palabras de esta pregunta; las referencias no garantizan exactitud.`
        : context.trimmed
          ? 'Para mantener la conversación ágil, el modelo usa los intercambios recientes que caben en su contexto. El historial completo sigue guardado.'
          : '',
    );
    reply.documentPage = documentContext ? conversation.documentPage || null : null;
    reply.model = state.selectedModel;
    conversation.model = state.selectedModel;
    reply.status = 'generating';
    reply.content = '';
    delete reply.finishReason;
    reply.documentMode = !!documentContext;
    if (documentContext) reply.retrievalTopic = context.topic;
    else delete reply.retrievalTopic;
    if (documentContext) reply.sources = structuredClone(context.sources);
    else delete reply.sources;
    renderConversation();
    renderHistory();
    scrollToEnd();
    announce('Generando respuesta.');
    void save(conversation);
    let lastRender = 0;
    let finishReason;
    try {
      if (documentContext && !context.sources.length) {
        reply.content = context.clarification
          ? '¿A qué tema te refieres? Nombra el asunto del documento o de la biblioteca para poder buscarlo.'
          : context.kind === 'knowledge'
            ? 'No encontré información relacionada en la biblioteca de este proyecto. Prueba con palabras del contenido guardado o desactiva «Usar biblioteca y memoria» para usar el chat general.'
            : 'No encontré fragmentos relacionados con esta pregunta. Prueba con palabras del documento o desactiva «Responder con este documento» para usar el chat general.';
        reply.status = 'complete';
        announce('No se encontraron fragmentos relacionados.');
        return;
      }
      for await (const chunk of runtime.generate(context.messages, {
        temperature: documentContext ? 0 : 0.7,
      })) {
        if (state.stopping) continue;
        const choice = chunk.choices?.[0];
        reply.content += choice?.delta?.content || '';
        finishReason = choice?.finish_reason || finishReason;
        if (Date.now() - lastRender > 60) {
          const nearEnd = isNearEnd();
          const content = [...$('#messages').children]
            .find((item) => item.dataset.messageId === reply.id)
            ?.querySelector('.message-content');
          if (content) fillContent(content, reply);
          if (nearEnd) scrollToEnd();
          lastRender = Date.now();
        }
        if (!saveTimer)
          saveTimer = setTimeout(() => {
            saveTimer = null;
            void save(conversation);
          }, 800);
      }
      reply.status = state.stopping ? 'interrupted' : reply.content ? 'complete' : 'error';
      if (finishReason === 'length') {
        reply.finishReason = 'length';
        showNotice('La respuesta alcanzó el límite de longitud. Puedes pedir que continúe.');
      } else if (reply.status === 'error')
        showNotice('El modelo no devolvió texto. Puedes reintentar la respuesta.', 'error');
      announce(reply.status === 'complete' ? 'Respuesta completada.' : 'Respuesta interrumpida.');
    } catch (error) {
      console.error('Generación:', error);
      reply.status = state.stopping ? 'interrupted' : 'error';
      showNotice(
        'No se pudo completar la respuesta. Tu mensaje se conserva; pulsa Reintentar para volver a cargar el modelo y responder.',
        'error',
      );
      announce('No se pudo completar la respuesta.');
    } finally {
      clearTimeout(saveTimer);
      saveTimer = null;
      state.busy = false;
      state.stopping = false;
      conversation.updatedAt = Date.now();
      const nearEnd = isNearEnd();
      renderConversation();
      renderHistory();
      if (nearEnd) scrollToEnd();
      if (!runtime.ready) {
        $('#model-card').hidden = false;
        $('#model-title').textContent = 'Vuelve a preparar el modelo';
        $('#model-description').textContent =
          'El motor se detuvo. Puedes cargarlo de nuevo y continuar con tu conversación.';
      }
      await save(conversation);
    }
  }

  async function submit() {
    if (!state.initialized || state.busy || state.attaching || state.cacheBusy || !runtime.ready)
      return;
    const text = $('#prompt').value.trim();
    const error = validatePrompt(text);
    if (error) {
      showNotice(error, 'error');
      return;
    }
    const conversation = state.current;
    let documentContext;
    try {
      state.attaching = true;
      updateControls();
      documentContext = await prepareContext(text);
    } catch (error) {
      showNotice(error.message, 'error');
      return;
    } finally {
      state.attaching = false;
      updateControls();
    }
    if (state.current !== conversation) return;
    if (!conversation.messages.length) {
      conversation.title = text.replace(/\s+/g, ' ').slice(0, 65);
      if (!state.conversations.includes(conversation)) state.conversations.push(conversation);
    }
    conversation.messages.push(newMessage('user', text));
    const reply = newMessage('assistant', '', 'generating');
    conversation.messages.push(reply);
    conversation.updatedAt = Date.now();
    $('#prompt').value = '';
    clearDraft(conversation.id);
    resizePrompt();
    await generate(reply, documentContext);
  }

  async function retry(id) {
    if (state.busy || state.loading || state.attaching || state.cacheBusy) return;
    const conversation = state.current;
    const reply = conversation.messages.at(-1);
    if (reply?.id !== id || reply.role !== 'assistant') return;
    if (!runtime.ready && !(await loadModel())) return;
    // The user may select another conversation while a model is downloading.
    if (state.current !== conversation) return;
    let documentContext;
    try {
      state.attaching = true;
      updateControls();
      documentContext = await prepareContext(
        conversation.messages.at(-2).content,
        conversation.messages.slice(0, -2),
      );
    } catch (error) {
      showNotice(error.message, 'error');
      return;
    } finally {
      state.attaching = false;
      updateControls();
    }
    if (state.current !== conversation) return;
    await generate(reply, documentContext);
  }

  function confirmDeletion(all) {
    const dialog = $('#confirm-dialog');
    $('#confirm-title').textContent = all
      ? '¿Borrar todas las conversaciones?'
      : '¿Eliminar conversación?';
    $('#confirm-description').textContent =
      'Se eliminarán también los documentos, fragmentos y recuerdos derivados de estos chats. Las notas y documentos independientes de la biblioteca se conservan. Puedes exportar una copia antes de eliminarla.';
    dialog.returnValue = '';
    dialog.showModal();
    dialog.querySelector('[value="cancel"]').focus();
    return new Promise((resolve) =>
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), {
        once: true,
      }),
    );
  }

  async function remove(all = false) {
    if (state.busy || state.attaching || !(await confirmDeletion(all))) return;
    const removedId = state.current.id;
    try {
      if (all) await store.clear();
      else {
        const deleted = await store.delete(removedId, state.current.updatedAt);
        if (deleted === false) {
          await refreshConversation(removedId);
          showNotice(
            'Esta conversación cambió en otra pestaña. Se conservó la versión más reciente.',
            'error',
          );
          return;
        }
      }
    } catch (error) {
      console.error(error);
      showNotice('No se pudieron borrar los datos del navegador. Vuelve a intentarlo.', 'error');
      return;
    }
    publishSync(
      all
        ? { type: 'conversations-cleared' }
        : { type: 'conversation-deleted', id: removedId, updatedAt: Date.now() },
    );
    if (all) {
      state.conversations = [];
      state.drafts.clear();
      flushDrafts();
    } else {
      clearDraft(state.current.id);
      state.conversations = state.conversations.filter(
        (conversation) => conversation.id !== state.current.id,
      );
    }
    $('#manage-dialog').close();
    $('#privacy-dialog').close();
    state.current = null;
    selectConversation(newConversation());
    announce(all ? 'Historial eliminado.' : 'Conversación eliminada.');
  }

  async function duplicate() {
    if (
      !state.initialized ||
      state.busy ||
      state.attaching ||
      (!state.current?.messages.length && !state.current?.document)
    )
      return;
    const copy = duplicateConversation(state.current);
    state.attaching = true;
    updateControls();
    try {
      const saved = await store.save(copy);
      if (saved === false) throw new Error('El almacenamiento rechazó la copia.');
      state.conversations.push(copy);
      publishSync({ type: 'conversation-changed', id: copy.id, updatedAt: copy.updatedAt });
      state.attaching = false;
      $('#manage-dialog').close();
      selectConversation(copy);
      showNotice('Copia creada. Puedes continuar aquí; la conversación original se conserva.');
      announce('Conversación duplicada.');
      return copy;
    } catch (error) {
      console.error('No se pudo duplicar la conversación:', error);
      showNotice('No se pudo guardar la copia. Vuelve a intentarlo.', 'error');
    } finally {
      state.attaching = false;
      updateControls();
    }
  }

  function openEdit(messageId) {
    if (!state.initialized || state.busy || state.loading || state.attaching || state.cacheBusy)
      return;
    const message = state.current.messages.find((entry) => entry.id === messageId);
    if (message?.role !== 'user') return;
    pendingEdit = { conversation: state.current, updatedAt: state.current.updatedAt, messageId };
    $('#edit-prompt').value = message.content;
    $('#edit-context').textContent =
      `Se usará la configuración actual: ${contextDescription(state.current)}.`;
    $('#edit-status').textContent = '';
    $('#edit-dialog').showModal();
    $('#edit-prompt').focus();
  }

  async function acceptEdit() {
    if (
      !pendingEdit ||
      savingEdit ||
      state.busy ||
      state.loading ||
      state.attaching ||
      state.cacheBusy
    )
      return;
    const { conversation, updatedAt, messageId } = pendingEdit;
    if (state.current !== conversation || conversation.updatedAt !== updatedAt) {
      $('#edit-status').textContent =
        'La conversación cambió. Cierra este editor y vuelve a abrir la pregunta.';
      return;
    }
    let copy;
    try {
      copy = branchConversation(conversation, messageId, $('#edit-prompt').value);
    } catch (error) {
      $('#edit-status').textContent = error.message;
      return;
    }
    savingEdit = true;
    state.attaching = true;
    $('#create-version').disabled = true;
    $('#cancel-edit').disabled = true;
    $('#edit-prompt').disabled = true;
    updateControls();
    let saved = false;
    try {
      if ((await store.save(copy)) === false) throw new Error('No se pudo guardar la versión.');
      saved = true;
      state.conversations.push(copy);
      publishSync({ type: 'conversation-changed', id: copy.id, updatedAt: copy.updatedAt });
      $('#edit-dialog').close();
      state.attaching = false;
      $('#search').value = '';
      selectConversation(copy);
      announce('Nueva versión guardada.');
    } catch {
      $('#edit-status').textContent =
        'No se pudo guardar la versión. Tu edición se conserva; vuelve a intentarlo.';
    } finally {
      savingEdit = false;
      state.attaching = false;
      $('#create-version').disabled = false;
      $('#cancel-edit').disabled = false;
      $('#edit-prompt').disabled = false;
      updateControls();
    }
    if (!saved) return;
    if (runtime.ready) await retry(copy.messages.at(-1).id);
    else showNotice('Versión guardada. Pulsa Reintentar para cargar el modelo y responder.');
  }

  function download(format) {
    const conversation = state.current;
    const text =
      format === 'json'
        ? JSON.stringify({ schemaVersion: 1, ...conversation }, null, 2)
        : exportMarkdown(conversation);
    const blob = new Blob([text], {
      type: format === 'json' ? 'application/json' : 'text/markdown;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = doc.createElement('a');
    link.href = url;
    link.download = `${
      conversation.title
        .replace(/[^\p{L}\p{N}\s_-]/gu, '')
        .trim()
        .slice(0, 60) || 'conversacion'
    }.${format}`;
    doc.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyMessage(id, button) {
    const message = state.current.messages.find((entry) => entry.id === id);
    if (!message) return;
    try {
      await window.navigator.clipboard.writeText(message.content);
      button.textContent = 'Copiado';
      announce('Respuesta copiada.');
      setTimeout(() => {
        button.textContent = 'Copiar';
      }, 1600);
    } catch {
      showNotice(
        'No se pudo acceder al portapapeles. Selecciona el texto y cópialo manualmente.',
        'error',
      );
    }
  }

  function renderDocument() {
    const document = state.current?.document;
    $('#document-card').hidden = !document;
    $('#view-document').textContent = document ? `▤ ${document.name}` : '';
    $('#use-document').checked = state.current?.useDocument !== false;
    $('#attach-document').title = document
      ? 'Retira el documento actual antes de adjuntar otro'
      : 'Texto hasta 100 KB o PDF hasta 10 MB / 100 páginas';
    $('#page-scope-label').hidden = !document?.pages;
    $('#page-scope').replaceChildren(
      new window.Option('Todas las páginas', ''),
      ...(document?.pages || []).map(
        (entry) =>
          new window.Option(
            `Página ${entry.page}${entry.text ? '' : ' · sin texto'}`,
            String(entry.page),
          ),
      ),
    );
    $('#page-scope').value = String(state.current?.documentPage || '');
    $('#page-scope').disabled = state.busy || state.attaching;
  }

  function showDocument(document, pending = false) {
    previewDocument = document;
    $('#preview-page-label').hidden = !document.pages;
    $('#preview-page').replaceChildren(
      ...(document.pages || []).map(
        (entry) => new window.Option(String(entry.page), String(entry.page)),
      ),
    );
    $('#document-title').textContent = document.name;
    $('#document-detail').textContent =
      `${Math.ceil(document.size / 1024)} KB · ${document.chunks.length} fragmentos · ${document.pages ? `${document.pages.length} páginas · Texto extraído (sin OCR)` : 'Texto UTF-8'}`;
    $('#document-preview').textContent = document.pages
      ? document.pages[0].text || 'Esta página no contiene texto extraíble.'
      : document.text;
    $('#confirm-document').hidden = !pending;
    $('#document-dialog').showModal();
  }

  async function attachDocument(file) {
    if (!state.initialized || state.busy || state.attaching || state.current.document) return;
    state.attaching = true;
    updateControls();
    showNotice(
      /\.pdf$/i.test(file.name)
        ? 'Leyendo las páginas del PDF en este dispositivo…'
        : 'Leyendo documento…',
    );
    try {
      const document = await readDocument(file);
      showNotice();
      pendingDocument = { document, conversation: state.current };
      showDocument(document, true);
    } catch (error) {
      showNotice(error.message || 'No se pudo leer el archivo.', 'error');
    } finally {
      state.attaching = false;
      $('#document-file').value = '';
      updateControls();
    }
  }

  async function acceptDocument() {
    if (!pendingDocument || state.busy || pendingDocument.conversation !== state.current) return;
    const { document, conversation } = pendingDocument;
    conversation.document = document;
    conversation.documentPage = null;
    conversation.useDocument = true;
    conversation.updatedAt = Date.now();
    if (!conversation.messages.length) conversation.title = document.name;
    if (!state.conversations.includes(conversation)) state.conversations.push(conversation);
    pendingDocument = null;
    $('#document-dialog').close();
    renderConversation();
    renderHistory();
    await save(conversation);
    if (!state.storageError)
      showNotice('Documento listo. Haz una pregunta concreta o pide un resumen parcial.');
    $('#prompt').focus();
  }

  async function removeDocument() {
    if (state.busy || state.attaching || !state.current.document) return;
    const conversation = state.current;
    const confirmed = confirmDeletion(false);
    $('#confirm-title').textContent = '¿Retirar el documento?';
    $('#confirm-description').textContent =
      'Se borrarán el archivo y sus fragmentos guardados. Los mensajes existentes pueden contener citas del texto; elimina la conversación para borrar también esos mensajes.';
    if (!(await confirmed)) return;
    const next = {
      ...conversation,
      useDocument: false,
      updatedAt: Date.now(),
      messages: conversation.messages.map((message) => {
        const copy = { ...message };
        delete copy.sources;
        return copy;
      }),
    };
    delete next.document;
    state.attaching = true;
    updateControls();
    try {
      const saved = await store.save(next);
      if (saved === false) {
        await refreshConversation(conversation.id);
        showNotice(
          'Esta conversación cambió en otra pestaña. Se conservó la versión más reciente.',
          'error',
        );
        return;
      }
      delete conversation.document;
      Object.assign(conversation, next);
      publishSync({
        type: 'conversation-changed',
        id: conversation.id,
        updatedAt: conversation.updatedAt,
      });
      $('#source-dialog').close();
      $('#source-text').textContent = '';
      $('#document-preview').textContent = '';
      renderConversation();
      renderHistory();
      showNotice('Documento retirado. Los mensajes anteriores se conservan.');
    } catch (error) {
      showNotice(
        'No se pudo retirar el documento del almacenamiento. Vuelve a intentarlo.',
        'error',
      );
    } finally {
      state.attaching = false;
      updateControls();
    }
  }

  function openSource(messageId, sourceId) {
    const message = state.current.messages.find((entry) => entry.id === messageId);
    const source = message?.sources?.find((entry) => entry.id === Number(sourceId));
    if (!source) return;
    $('#source-title').textContent =
      `Fragmento [${source.id}]${source.page ? ` · Página ${source.page}` : ''}`;
    $('#source-detail').textContent =
      `${source.name} · caracteres ${source.start + 1}–${source.end}${source.origin ? ` · Recuerdo de: ${source.origin.title || 'Conversación'} (${source.origin.role === 'assistant' ? 'asistente' : 'usuario'})` : ''}`;
    $('#source-text').textContent = source.text;
    const original = state.current.document;
    const page =
      original?.id === source.documentId
        ? original.pages?.find((entry) => entry.page === source.page)
        : null;
    $('#source-page-section').hidden = !page;
    $('#source-page-text').textContent = page?.text || '';
    $('#source-page-heading').textContent = page
      ? `Texto completo de la página ${source.page}`
      : '';

    $('#source-dialog').showModal();
  }

  async function start() {
    conversationImport.start();
    $('#edit-form').addEventListener('submit', (event) => {
      event.preventDefault();
      void acceptEdit();
    });
    $('#cancel-edit').addEventListener('click', () => {
      if (!savingEdit) $('#edit-dialog').close();
    });
    $('#edit-dialog').addEventListener('cancel', (event) => {
      if (savingEdit) event.preventDefault();
    });
    $('#edit-dialog').addEventListener('close', () => {
      pendingEdit = null;
      $('#edit-prompt').value = '';
      $('#edit-status').textContent = '';
    });
    $('#open-parent').addEventListener('click', () => {
      const parent = state.conversations.find(
        (entry) => entry.id === state.current?.branch?.parentId,
      );
      if (parent) selectConversation(parent);
    });
    $('#open-knowledge').addEventListener('click', () => void knowledgeUI.open());
    const saveKnowledgePreferences = () => {
      if (!state.initialized || state.busy || state.attaching) return;
      state.current.project = projectName($('#chat-project').value);
      state.current.useKnowledge = $('#use-knowledge').checked;
      state.current.updatedAt = Math.max(Date.now(), state.current.updatedAt + 1);
      if (!state.conversations.includes(state.current)) state.conversations.push(state.current);
      renderHistory();
      void save();
    };
    $('#chat-project').addEventListener('change', saveKnowledgePreferences);
    $('#use-knowledge').addEventListener('change', saveKnowledgePreferences);
    setFocusMode(state.focusMode);
    updateControls();
    syncChannel?.addEventListener('message', receiveSync);
    sidebar(false, false);
    mobile.addEventListener('change', () => sidebar(false, false));
    $('#open-sidebar').addEventListener('click', () => sidebar(true));
    $('#close-sidebar').addEventListener('click', () => sidebar(false));
    $('#sidebar-backdrop').addEventListener('click', () => sidebar(false));
    $('#focus-mode').addEventListener('click', () => setFocusMode(!state.focusMode));
    $('#search').addEventListener('input', renderHistory);
    $('#attach-document').addEventListener('click', () => $('#document-file').click());
    $('#document-file').addEventListener('change', () => {
      const file = $('#document-file').files?.[0];
      if (file) void attachDocument(file);
    });
    $('#model-select').replaceChildren(
      ...MODELS.map((model) => new window.Option(model.name, model.id)),
    );
    $('#model-select').value = state.selectedModel;
    $('#manage-models').addEventListener('click', () => {
      $('#models-dialog').showModal();
      void refreshCache();
    });
    $('#model-select').addEventListener('change', () => {
      if (state.busy || state.loading || state.attaching || state.cacheBusy) return;
      state.selectedModel = getModel($('#model-select').value).id;
      try {
        window.localStorage.setItem('semilla-model', state.selectedModel);
      } catch {
        showNotice('La selección de modelo no se conservará al cerrar esta pestaña.');
      }
      unloadModel();
      void refreshCache();
    });
    $('#refresh-cache').addEventListener('click', () => void refreshCache());
    $('#delete-model-cache').addEventListener('click', () => void deleteModelCache());
    $('#unload-model').addEventListener('click', unloadModel);
    $('#page-scope').addEventListener('change', () => {
      if (state.busy || state.attaching) return;
      state.current.documentPage = Number($('#page-scope').value) || null;
      state.current.updatedAt = Math.max(Date.now(), state.current.updatedAt + 1);
      renderHistory();
      void save();
    });
    $('#preview-page').addEventListener('change', () => {
      $('#document-preview').textContent =
        previewDocument?.pages.find((entry) => entry.page === Number($('#preview-page').value))
          ?.text || 'Esta página no contiene texto extraíble.';
    });
    $('#confirm-document').addEventListener('click', () => void acceptDocument());
    $('#document-dialog').addEventListener('close', () => {
      pendingDocument = null;
      previewDocument = null;
      $('#document-preview').textContent = '';
    });
    $('#source-dialog').addEventListener('close', () => {
      $('#source-text').textContent = '';
      $('#source-detail').textContent = '';
      $('#source-page-text').textContent = '';
      $('#source-page-section').open = false;
    });
    $('#view-document').addEventListener('click', () => {
      if (state.current.document) showDocument(state.current.document);
    });
    $('#remove-document').addEventListener('click', () => void removeDocument());
    $('#use-document').addEventListener('change', () => {
      if (state.busy) return;
      state.current.useDocument = $('#use-document').checked;
      state.current.updatedAt = Math.max(Date.now(), state.current.updatedAt + 1);
      renderHistory();
      void save();
    });
    $('#new-chat').addEventListener('click', () => selectConversation(newConversation()));
    $('#prompt').addEventListener('input', () => {
      rememberDraft(state.current);
      resizePrompt();
    });
    $('#prompt').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void submit();
      }
    });
    $('#composer').addEventListener('submit', (event) => {
      event.preventDefault();
      void submit();
    });
    $('#stop').addEventListener('click', () => {
      state.stopping = true;
      runtime.stop();
      updateControls();
    });
    $('#load-model').addEventListener('click', () =>
      state.loading ? runtime.dispose() : void loadModel(),
    );
    $('#history').addEventListener('click', (event) => {
      const button = event.target.closest('[data-id]');
      if (button)
        selectConversation(
          state.conversations.find((conversation) => conversation.id === button.dataset.id),
        );
    });
    doc.querySelectorAll('[data-prompt]').forEach((button) =>
      button.addEventListener('click', () => {
        $('#prompt').value = button.dataset.prompt;
        rememberDraft(state.current);
        resizePrompt();
        $('#prompt').focus();
      }),
    );
    $('#messages').addEventListener('click', (event) => {
      const edit = event.target.closest('[data-edit]');
      if (edit) openEdit(edit.dataset.edit);
      const remember = event.target.closest('[data-remember]');
      if (remember && !state.busy && !state.attaching) {
        const message = state.current.messages.find(
          (entry) => entry.id === remember.dataset.remember,
        );
        if (message?.status === 'complete') void knowledgeUI.open(message);
      }
      const copy = event.target.closest('[data-copy]');
      const retryButton = event.target.closest('[data-retry]');
      if (copy) void copyMessage(copy.dataset.copy, copy);
      if (retryButton) void retry(retryButton.dataset.retry);
      const source = event.target.closest('[data-source]');
      if (source) openSource(source.dataset.message, source.dataset.source);
    });
    $('#conversation-options').addEventListener('click', () => {
      $('#conversation-name').value = state.current.title;
      $('#manage-dialog').showModal();
    });
    $('#rename-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const title = $('#conversation-name').value.trim();
      if (!title) {
        $('#conversation-name').setCustomValidity('Escribe un nombre.');
        $('#conversation-name').reportValidity();
        return;
      }
      state.current.title = title;
      state.current.updatedAt = Date.now();
      renderConversation();
      renderHistory();
      $('#manage-dialog').close();
      await save();
    });
    $('#conversation-name').addEventListener('input', () =>
      $('#conversation-name').setCustomValidity(''),
    );
    $('#export-md').addEventListener('click', () => download('md'));
    $('#export-json').addEventListener('click', () => download('json'));
    $('#duplicate-chat').addEventListener('click', () => void duplicate());
    $('#delete-chat').addEventListener('click', () => void remove());
    $('#clear-data').addEventListener('click', () => void remove(true));
    $('#privacy').addEventListener('click', () => $('#privacy-dialog').showModal());
    doc
      .querySelectorAll('[data-close]')
      .forEach((button) =>
        button.addEventListener('click', () => button.closest('dialog').close()),
      );
    doc.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !doc.querySelector('dialog[open]')) sidebar(false);
      if (event.altKey && event.key.toLowerCase() === 'n' && !doc.querySelector('dialog[open]')) {
        event.preventDefault();
        if (state.initialized) selectConversation(newConversation());
      }
      if (event.altKey && event.key.toLowerCase() === 'f' && !doc.querySelector('dialog[open]')) {
        event.preventDefault();
        setFocusMode(!state.focusMode);
      }
      if (
        event.key === 'Tab' &&
        mobile.matches &&
        $('#sidebar').classList.contains('is-open') &&
        !doc.querySelector('dialog[open]')
      ) {
        const focusable = [
          ...$('#sidebar').querySelectorAll('button:not(:disabled),a,input'),
        ].filter((el) => !el.hidden);
        const first = focusable[0],
          last = focusable.at(-1);
        if (event.shiftKey && doc.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && doc.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });
    doc.addEventListener('visibilitychange', () => {
      if (doc.visibilityState === 'hidden') {
        flushDrafts();
        void save();
      }
    });
    window.addEventListener('beforeunload', (event) => {
      flushDrafts();
      if (state.busy || state.storageError) {
        event.preventDefault();
        event.returnValue = '';
      }
      syncChannel?.close?.();
    });
    const storageReady = (async () => {
      try {
        await store.open();
        state.conversations = (await store.list()).map(recoverConversation);
      } catch (error) {
        console.error('Historial:', error);
        state.storageError = true;
        showNotice('', 'error');
      }
      state.initialized = true;
      selectConversation(
        [...state.conversations].sort((a, b) => b.updatedAt - a.updatedAt)[0] || newConversation(),
      );
    })();
    const compatibilityReady = (async () => {
      try {
        const result = await checkCompatibility();
        state.supported = result.supported;
        if (!result.supported) {
          $('#model-title').textContent = 'La IA local no está disponible';
          $('#model-description').textContent = result.reason;
          $('#load-model').textContent = 'No compatible';
        }
      } catch (error) {
        console.error('Compatibilidad:', error);
        state.supported = false;
        $('#model-title').textContent = 'No se pudo comprobar la compatibilidad';
        $('#model-description').textContent =
          'El historial sigue disponible, pero no podemos cargar la IA local en este momento.';
        $('#load-model').textContent = 'No disponible';
        compatibilityFailureNotice =
          'No se pudo comprobar la compatibilidad con la IA local. Puedes consultar y exportar tu historial.';
        showNotice(compatibilityFailureNotice, 'error');
      }
      updateControls();
    })();
    await Promise.all([storageReady, compatibilityReady]);
    if (compatibilityFailureNotice) showNotice(compatibilityFailureNotice, 'error');
    updateControls();
  }

  return {
    start,
    state,
    submit,
    retry,
    loadModel,
    selectConversation,
    remove,
    duplicate,
    save,
    attachDocument,
    acceptDocument,
    removeDocument,
    refreshCache,
    deleteModelCache,
  };
}
