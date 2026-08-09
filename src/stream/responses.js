// OpenAI Responses SSE event parsing — extracted from HarnessRouter's chat client
// (harnessrouter/src/lib/chat.ts streamResponse). Transport-agnostic: the caller does the
// fetch/POST however it likes (BFF, broker, direct) and hands the response body (a
// ReadableStream) plus a handlers object here.
//
// Two layers:
//   readSSEStream(body, onData)        — raw SSE framing (blank-line separated, data: lines)
//   createResponsesDispatcher(handlers) — native Responses event -> handler dispatch
//   pumpResponsesStream(body, handlers) — both together; resolves to the response id
//
// Handlers (all optional):
//   onCreated(responseId)              response.created
//   onSession(sessionId)               response.created metadata.session_id (continuation)
//   onReasoningDelta(text)             response.reasoning_summary_text.delta
//   onToolCall(name, args, callId)     response.function_call_arguments.done (name + call_id
//                                      captured from the matching output_item.added, keyed by
//                                      output_index — the same pairing HR ships)
//   onToolResult(callId, output)       function_call_output items
//   onTextDelta(text)                  response.output_text.delta
//   onFile({container_id,file_id,filename})  container_file_citation annotations
//   onDone(status, response)           response.completed / .incomplete / .failed (a failed
//                                      response's own status distinguishes user cancels)
//   onError(message)                   error events

export function createResponsesDispatcher(h) {
  // function_call name + call_id live on output_item.added; arguments finalize on .done — key by
  // output_index. function_call_output (the tool result) carries the same call_id → pair them.
  const fnByIdx = {};
  const self = {
    responseId: null,
    dispatch(ev) {
      const t = ev.type;
      switch (t) {
        case 'response.created': {
          const resp = ev.response || {};
          self.responseId = resp.id || self.responseId;
          if (self.responseId) h.onCreated?.(self.responseId);
          const sid = (resp.metadata && resp.metadata.session_id) || '';
          if (sid) h.onSession?.(sid);
          break;
        }
        case 'response.reasoning_summary_text.delta':
          h.onReasoningDelta?.(ev.delta || '');
          break;
        case 'response.output_item.added': {
          const item = ev.item || {};
          if (item.type === 'function_call') {
            fnByIdx[ev.output_index] = { name: item.name || 'tool', callId: item.call_id || '' };
          } else if (item.type === 'function_call_output') {
            h.onToolResult?.(item.call_id || '', String(item.output ?? ''));
          }
          break;
        }
        case 'response.function_call_arguments.done': {
          const fn = fnByIdx[ev.output_index] || { name: 'tool', callId: '' };
          h.onToolCall?.(fn.name, ev.arguments || '', fn.callId);
          break;
        }
        case 'response.output_text.delta':
          h.onTextDelta?.(ev.delta || '');
          break;
        case 'response.output_text.annotation.added': {
          const a = ev.annotation || {};
          if (a.type === 'container_file_citation') {
            h.onFile?.({ container_id: a.container_id, file_id: a.file_id, filename: a.filename });
          }
          break;
        }
        case 'response.completed':
          h.onDone?.('completed', ev.response);
          break;
        case 'response.incomplete':
          h.onDone?.('incomplete', ev.response);
          break;
        case 'response.failed':
          // the response object's own status distinguishes a user cancel ('cancelled')
          // from a real failure — surface it so the UI can badge them differently
          h.onDone?.((ev.response && ev.response.status) || 'failed', ev.response);
          break;
        case 'error':
          h.onError?.(ev.message || 'stream error');
          break;
        default:
          break;
      }
    },
  };
  return self;
}

/** Read an SSE body stream, calling onData(dataString) per frame (data: lines joined). */
export async function readSSEStream(body, onData) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    // SSE frames are separated by a blank line; each frame has one or more `data:` lines.
    while ((nl = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
      if (!data) continue;
      onData(data);
    }
  }
}

/**
 * Convenience: parse a Responses SSE body end-to-end, dispatching to handlers.
 * Resolves to the response id (for previous_response_id chaining), or null.
 */
export async function pumpResponsesStream(body, handlers) {
  const d = createResponsesDispatcher(handlers);
  await readSSEStream(body, (data) => {
    try { d.dispatch(JSON.parse(data)); } catch { /* ignore malformed frame */ }
  });
  return d.responseId;
}
