// Navigation: mobile toggle + accessibility state.
document.addEventListener('DOMContentLoaded', function () {
    var toggleBtn = document.querySelector('.nav-toggle');
    var navLinks = document.querySelector('.nav-links');

    if (!toggleBtn || !navLinks) return;

    function setOpen(open) {
        navLinks.classList.toggle('open', open);
        // Screen readers need the state; the CSS only knows about the class.
        toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggleBtn.textContent = open ? '✕' : '☰';
        toggleBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    }

    toggleBtn.addEventListener('click', function () {
        setOpen(!navLinks.classList.contains('open'));
    });

    // Clicking a link closes the menu (it is an overlay on small screens, so
    // leaving it open would hide the page the user just navigated to).
    navLinks.querySelectorAll('a').forEach(function (link) {
        link.addEventListener('click', function () { setOpen(false); });
    });

    // Escape closes it, matching every other disclosure menu.
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && navLinks.classList.contains('open')) {
            setOpen(false);
            toggleBtn.focus();
        }
    });

    // Clicking outside closes it. Without this the overlay stays up and the
    // page underneath looks broken on a phone.
    document.addEventListener('click', function (e) {
        if (!navLinks.classList.contains('open')) return;
        if (navLinks.contains(e.target) || toggleBtn.contains(e.target)) return;
        setOpen(false);
    });

    // A resize from mobile width to desktop leaves the menu "open" but hidden by
    // CSS; reset the flag so the next mobile view starts closed.
    window.addEventListener('resize', function () {
        if (window.innerWidth > 1024 && navLinks.classList.contains('open')) {
            setOpen(false);
        }
    });
});