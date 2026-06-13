// Navigation mobile toggle
document.addEventListener('DOMContentLoaded', function() {
    const toggleBtn = document.querySelector('.nav-toggle');
    const navLinks = document.querySelector('.nav-links');

    if (toggleBtn && navLinks) {
        toggleBtn.addEventListener('click', function() {
            navLinks.classList.toggle('open');
        });
    }

    // Close nav when a link is clicked
    document.querySelectorAll('.nav-links a').forEach(function(link) {
        link.addEventListener('click', function() {
            if (navLinks) navLinks.classList.remove('open');
        });
    });
});