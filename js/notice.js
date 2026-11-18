/*
 * js/notice.js
 *
 * On-page notice dialog used by reservas.js and paypal-checkout.js instead
 * of window.alert(). A native alert can be silently suppressed by the
 * browser ("prevent this page from creating more dialogs", some webviews)
 * with no way to detect it, so a successful booking could go unannounced.
 * This is a plain <div> we control, styled like the login modal
 * (.inercia-dialog in css/reservas.css).
 *
 * showNotice(text, { title, onClose, autoCloseMs })
 *   - text is rendered with textContent (never HTML) and keeps line breaks.
 *   - onClose runs exactly once: on ACEPTAR, ×, Escape, backdrop click, or
 *     after autoCloseMs (default 8 s) so flows that wait on it (e.g. the
 *     PayPal reload) never hang. Pass autoCloseMs: 0 to disable.
 */

const NOTICE_ID = 'inercia-notice';

export function showNotice(
    text,
    {
        title = 'LISTO',
        onClose,
        autoCloseMs = 8000
    } = {}
) {

    document.getElementById(NOTICE_ID)?.remove();

    let closed = false;
    let timer = null;
    const previousFocus = document.activeElement;

    const overlay = document.createElement('div');
    overlay.id = NOTICE_ID;
    overlay.className = 'inercia-dialog';

    overlay.innerHTML = `
        <div class="inercia-dialog-backdrop"></div>
        <div class="inercia-dialog-panel" role="alertdialog" aria-modal="true"
             aria-labelledby="${NOTICE_ID}-title" aria-describedby="${NOTICE_ID}-text">
            <button type="button" class="inercia-dialog-close" aria-label="Cerrar">&times;</button>
            <h2 class="inercia-dialog-title" id="${NOTICE_ID}-title"></h2>
            <p class="inercia-dialog-text inercia-dialog-text--pre" id="${NOTICE_ID}-text"></p>
            <button type="button" class="inercia-dialog-primary">ACEPTAR</button>
        </div>
    `;

    overlay.querySelector('.inercia-dialog-title').textContent = title;
    overlay.querySelector('.inercia-dialog-text').textContent = text;

    const close = () => {
        if (closed) return;
        closed = true;

        clearTimeout(timer);
        document.removeEventListener('keydown', onKeydown);
        overlay.remove();

        if (previousFocus && typeof previousFocus.focus === 'function') {
            previousFocus.focus();
        }

        if (typeof onClose === 'function') {
            try {
                onClose();
            } catch (error) {
                console.error('[NOTICE] Error en onClose:', error);
            }
        }
    };

    const onKeydown = (event) => {
        if (event.key === 'Escape') close();
    };

    overlay.querySelector('.inercia-dialog-primary').addEventListener('click', close);
    overlay.querySelector('.inercia-dialog-close').addEventListener('click', close);
    overlay.querySelector('.inercia-dialog-backdrop').addEventListener('click', close);
    document.addEventListener('keydown', onKeydown);

    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
        overlay.classList.add('open');
        overlay.querySelector('.inercia-dialog-primary')?.focus();
    });

    if (autoCloseMs > 0) {
        timer = setTimeout(close, autoCloseMs);
    }

    return close;
}
