// Cookie consent banner
(function() {
    var banner = document.getElementById('cookieConsent');
    var accept = document.getElementById('cookieAccept');
    if (!banner || !accept) return;
    if (!localStorage.getItem('drumdash_cookie_consent')) {
        banner.classList.add('show');
    }
    accept.addEventListener('click', function() {
        localStorage.setItem('drumdash_cookie_consent', 'accepted');
        banner.classList.remove('show');
    });
})();