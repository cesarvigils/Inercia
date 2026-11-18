/*
 * js/notice.js
 *
 * On-page notice dialog used by reservas.js and paypal-checkout.js instead
 * of window.alert(). A native alert can be silently suppressed by the
 * browser ("prevent this page from creating more dialogs", some webviews)
 * with no way to detect it, so a successful booking could go unannounced.
 * This is a plain <div> we control, styled like the login modal
 * (same auth-modal classes as css/auth.css).
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
    overlay.className = 'auth-modal';

    overlay.innerHTML = `
        <div class="auth-modal-backdrop"></div>
        <div class="auth-modal-panel" role="alertdialog" aria-modal="true"
             aria-labelledby="${NOTICE_ID}-title" aria-describedby="${NOTICE_ID}-text">
            <button type="button" class="auth-modal-close" aria-label="Cerrar">&times;</button>
            <div class="auth-heading">
                <h2 id="${NOTICE_ID}-title"></h2>
                <p class="notice-text" id="${NOTICE_ID}-text"></p>
            </div>
            <button type="button" class="auth-submit">ACEPTAR</button>
        </div>
    `;

    overlay.querySelector('.auth-heading h2').textContent = title;
    overlay.querySelector('.notice-text').textContent = text;

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

    overlay.querySelector('.auth-submit').addEventListener('click', close);
    overlay.querySelector('.auth-modal-close').addEventListener('click', close);
    overlay.querySelector('.auth-modal-backdrop').addEventListener('click', close);
    document.addEventListener('keydown', onKeydown);

    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
        overlay.classList.add('open');
        overlay.querySelector('.auth-submit')?.focus();
    });

    if (autoCloseMs > 0) {
        timer = setTimeout(close, autoCloseMs);
    }

    return close;
}
