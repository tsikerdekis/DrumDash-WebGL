/**
 * DrumDash Affiliate Ad Engine
 * Detects user country, matches providers, and renders product cards.
 */
(function () {
    'use strict';

    const CONFIG_URL = 'assets/js/affiliate-products.json';
    const STORAGE_KEY = 'dd_affiliate_state';
    const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

    // Free IP geolocation endpoint (no API key required, CORS-friendly)
    const GEO_ENDPOINTS = [
        'https://ipapi.co/json/',
        'https://get.geojs.io/v1/ip/country.json'
    ];

    let config = null;
    let userCountry = null;

    /**
     * Initialize the affiliate engine.
     */
    async function init() {
        try {
            config = await loadConfig();
            userCountry = await detectCountry();
            const products = selectProducts();
            render(products);
        } catch (err) {
            console.warn('[AffiliateEngine] init failed:', err);
            // Silently fail — no ads is better than broken ads
        }
    }

    /**
     * Load affiliate config JSON.
     */
    async function loadConfig() {
        const res = await fetch(CONFIG_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load affiliate config');
        return await res.json();
    }

    /**
     * Detect user's country code using IP geolocation.
     * Falls back to browser timezone / locale.
     */
    async function detectCountry() {
        // 1. Try IP geolocation
        for (const url of GEO_ENDPOINTS) {
            try {
                const res = await fetch(url, { mode: 'cors', cache: 'no-store' });
                if (!res.ok) continue;
                const data = await res.json();
                const code = (data.country_code || data.country || '').toUpperCase();
                if (code && /^[A-Z]{2}$/.test(code)) return code;
            } catch (e) {
                // Try next endpoint
            }
        }

        // 2. Fallback: browser timezone
        try {
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const tzMap = {
                'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US',
                'America/Los_Angeles': 'US', 'America/Phoenix': 'US', 'America/Anchorage': 'US',
                'America/Honolulu': 'US', 'Europe/London': 'GB', 'Europe/Dublin': 'IE',
                'Europe/Paris': 'FR', 'Europe/Berlin': 'DE', 'Europe/Madrid': 'ES',
                'Europe/Rome': 'IT', 'Europe/Amsterdam': 'NL', 'Europe/Brussels': 'BE',
                'Europe/Vienna': 'AT', 'Europe/Zurich': 'CH', 'Europe/Stockholm': 'SE',
                'Europe/Oslo': 'NO', 'Europe/Copenhagen': 'DK', 'Europe/Helsinki': 'FI',
                'Europe/Warsaw': 'PL', 'Europe/Prague': 'CZ', 'Europe/Budapest': 'HU',
                'Europe/Lisbon': 'PT', 'Europe/Athens': 'GR', 'Europe/Luxembourg': 'LU',
                'Europe/Bratislava': 'SK', 'Europe/Ljubljana': 'SI', 'Europe/Zagreb': 'HR',
                'Europe/Vilnius': 'LT', 'Europe/Riga': 'LV', 'Europe/Tallinn': 'EE',
                'Europe/Sofia': 'BG', 'Europe/Bucharest': 'RO', 'Europe/Nicosia': 'CY',
                'Europe/Malta': 'MT', 'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU',
                'Canada/Toronto': 'CA', 'Canada/Vancouver': 'CA', 'Canada/Montreal': 'CA',
                'Asia/Tokyo': 'JP'
            };
            if (tzMap[tz]) return tzMap[tz];
        } catch (e) { /* ignore */ }

        // 3. Fallback: navigator.language
        try {
            const lang = navigator.language || navigator.userLanguage || '';
            const langMap = {
                'en-US': 'US', 'en-GB': 'GB', 'en-CA': 'CA', 'en-AU': 'AU',
                'de-DE': 'DE', 'de-AT': 'AT', 'de-CH': 'CH',
                'fr-FR': 'FR', 'fr-CA': 'CA', 'fr-BE': 'BE', 'fr-CH': 'CH',
                'es-ES': 'ES', 'es-MX': 'MX', 'it-IT': 'IT', 'nl-NL': 'NL',
                'nl-BE': 'BE', 'pt-PT': 'PT', 'pt-BR': 'BR', 'sv-SE': 'SE',
                'nb-NO': 'NO', 'da-DK': 'DK', 'fi-FI': 'FI', 'pl-PL': 'PL',
                'cs-CZ': 'CZ', 'hu-HU': 'HU', 'el-GR': 'GR', 'ja-JP': 'JP'
            };
            if (langMap[lang]) return langMap[lang];
        } catch (e) { /* ignore */ }

        return config.settings.fallbackCountries[0] || 'US';
    }

    /**
     * Determine which providers are available for the detected country.
     */
    function getAvailableProviders() {
        const providers = [];
        for (const [key, provider] of Object.entries(config.providers)) {
            if (provider.countries.includes(userCountry)) {
                providers.push(key);
            }
        }
        // If no match, use fallback provider
        if (providers.length === 0) {
            providers.push(config.settings.fallbackProvider);
        }
        return providers;
    }

    /**
     * Select products to display.
     * Picks up to maxProductsPerSession, randomizing from available providers.
     */
    function selectProducts() {
        const availableProviders = getAvailableProviders();
        const eligibleProducts = config.products.filter(p => {
            return availableProviders.some(pid => p.links[pid]);
        });

        if (eligibleProducts.length === 0) return [];

        // Shuffle and pick
        const shuffled = shuffleArray([...eligibleProducts]);
        const count = Math.min(config.settings.maxProductsPerSession, shuffled.length);
        const selected = shuffled.slice(0, count);

        // Attach the best provider link for each
        return selected.map(product => {
            const provider = availableProviders.find(pid => product.links[pid]) || availableProviders[0];
            return {
                ...product,
                link: product.links[provider],
                providerName: config.providers[provider].name
            };
        });
    }

    /**
     * Render product cards into the DOM.
     */
    function render(products) {
        if (products.length === 0) return;

        let container = document.getElementById('affiliate-ad-container');
        const sidebar = document.getElementById('affiliate-sidebar');

        if (!container) {
            container = document.createElement('div');
            container.id = 'affiliate-ad-container';
            container.className = 'affiliate-ad-container';

            // If sidebar exists, put it there; otherwise fall back to old behavior
            if (sidebar) {
                sidebar.appendChild(container);
            } else {
                const gameWrapper = document.querySelector('.game-wrapper');
                const playInfo = document.querySelector('.play-info');
                if (gameWrapper && gameWrapper.parentNode) {
                    const main = gameWrapper.closest('main');
                    if (main && main.nextElementSibling) {
                        main.parentNode.insertBefore(container, main.nextElementSibling);
                    } else if (main) {
                        main.after(container);
                    } else {
                        gameWrapper.after(container);
                    }
                } else if (playInfo && playInfo.parentNode) {
                    playInfo.parentNode.insertBefore(container, playInfo);
                } else {
                    document.body.appendChild(container);
                }
            }
        }

        const labels = config.settings.displayLabels;

        const html = `
            <div class="affiliate-ad-header">
                <span class="affiliate-ad-label">${escapeHtml(labels.sponsored)}</span>
                <span class="affiliate-ad-disclosure">${escapeHtml(labels.disclosure)}</span>
            </div>
            <div class="affiliate-ad-grid">
                ${products.map(p => `
                    <a href="${escapeHtml(p.link)}" target="_blank" rel="noopener sponsored" class="affiliate-ad-card" data-product-id="${escapeHtml(p.id)}">
                        <div class="affiliate-ad-image-wrap">
                            <img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" loading="lazy" onerror="this.style.display='none'">
                            <span class="affiliate-ad-category">${escapeHtml(p.category)}</span>
                        </div>
                        <div class="affiliate-ad-body">
                            <h4 class="affiliate-ad-title">${escapeHtml(p.name)}</h4>
                            <p class="affiliate-ad-desc">${escapeHtml(p.description)}</p>
                            <span class="affiliate-ad-cta">${escapeHtml(labels.cta)}</span>
                        </div>
                    </a>
                `).join('')}
            </div>
        `;

        container.innerHTML = html;

        // Track clicks (basic analytics)
        container.querySelectorAll('.affiliate-ad-card').forEach(card => {
            card.addEventListener('click', () => {
                if (typeof gtag !== 'undefined') {
                    gtag('event', 'affiliate_click', {
                        event_category: 'Affiliate',
                        event_label: card.dataset.productId,
                        value: 1
                    });
                }
            });
        });
    }

    /**
     * Fisher-Yates shuffle.
     */
    function shuffleArray(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    /**
     * Escape HTML to prevent XSS.
     */
    function escapeHtml(str) {
        if (typeof str !== 'string') return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // Auto-init when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
