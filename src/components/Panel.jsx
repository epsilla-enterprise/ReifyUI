// Panel — the frame around one thing on a board: a header you can grab, a body, and the two
// states that body spends most of its life in.
//
// The states are the reason this exists. A panel whose content is being fetched has to hold its
// box (a grid that reflows as four requests land in four different orders is unreadable), and a
// panel whose content FAILED has to show why, verbatim and selectable. Products keep replacing
// that second one with "Something went wrong", which throws away the one string that tells the
// person what to fix.
//
// `loading` blanks the body — the first fetch, when there is nothing to keep. `busy` leaves the
// content up and marks the header — a refresh, where blanking a chart the person is reading to
// redraw the same chart is worse than waiting.
import { Button } from './form.jsx';

/**
 * title        the panel's name
 * titleAs      heading level, so a board fits YOUR document outline ('h3')
 * meta         quiet second line under the title (when it was refreshed, what it counts)
 * actions      controls in the header, after the title — never drag the panel
 * footer       quiet strip under the body
 * loading      no content yet: the body is a placeholder of the same size
 * busy         content is up but being refreshed: the header shows it
 * error        what went wrong, verbatim. Shown in monospace, selectable, and scrollable —
 *              a query error is a thing people copy
 * errorDetail  extra context under the message, folded away (the statement that failed)
 * onRetry      absent → no retry control is drawn, rather than a dead one
 */
export function Panel(props) {
  const {
    title, titleAs: Heading = 'h3', meta, actions, footer,
    loading = false, loadingLabel = 'Loading',
    busy = false, busyLabel = 'Refreshing',
    error = null, errorTitle = 'This panel could not load',
    errorDetail = null, detailLabel = 'Details',
    onRetry, retryLabel = 'Try again',
    className = '', classNames = {}, children,
  } = props;

  const body = loading ? (
    <div className="uic-panel-load">
      <span className="uic-panel-load-bar" />
      <span className="uic-panel-load-bar" />
      <span className="uic-panel-load-bar" />
      <span className="uic-sr">{loadingLabel}</span>
    </div>
  ) : error ? (
    <div className="uic-panel-fail">
      <p className="uic-panel-fail-t">{errorTitle}</p>
      <pre className="uic-panel-fail-m">{error}</pre>
      {errorDetail ? (
        <details className="uic-panel-fail-d">
          <summary>{detailLabel}</summary>
          <div className="uic-panel-fail-dd">{errorDetail}</div>
        </details>
      ) : null}
      {onRetry ? (
        <div className="uic-panel-fail-act">
          <Button size="sm" onClick={onRetry}>{retryLabel}</Button>
        </div>
      ) : null}
    </div>
  ) : children;

  return (
    <section
      className={['uic-panel', className, classNames.root || ''].filter(Boolean).join(' ')}
      aria-busy={loading || busy || undefined}
    >
      <header className={['uic-panel-head', classNames.head || ''].filter(Boolean).join(' ')}>
        <div className="uic-panel-titles">
          {title ? <Heading className="uic-panel-title">{title}</Heading> : null}
          {meta ? <p className="uic-panel-meta">{meta}</p> : null}
        </div>
        {actions ? <div className="uic-panel-acts">{actions}</div> : null}
      </header>
      {/* One indeterminate line, not a percentage: nothing here knows how far along a refresh is. */}
      {busy ? <div className="uic-panel-busy" role="status" aria-label={busyLabel} /> : null}
      <div className={['uic-panel-body', classNames.body || ''].filter(Boolean).join(' ')}>{body}</div>
      {footer ? <footer className="uic-panel-foot">{footer}</footer> : null}
    </section>
  );
}
