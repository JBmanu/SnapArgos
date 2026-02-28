/**
 * legal.js — Collapsible sections for the legal page
 * @param {string|null} openSection  - ID suffix to open (e.g. 'disclaimer'). All others stay closed.
 */
export function initLegal(openSection = null) {
    document.querySelectorAll('.legal-section').forEach(section => {
        const head = section.querySelector('.legal-section-head');
        if (!head) return;

        // Determine initial state: open only the target section (if any), else all collapsed
        const sectionId = section.id.replace('legal-', ''); // e.g. 'disclaimer'
        const shouldOpen = openSection ? sectionId === openSection : false;
        section.classList.toggle('collapsed', !shouldOpen);
        head.setAttribute('aria-expanded', String(shouldOpen));

        head.addEventListener('click', e => {
            if (e.target.closest('.legal-download-btn')) return;
            const isOpen = !section.classList.contains('collapsed');
            section.classList.toggle('collapsed', isOpen);
            head.setAttribute('aria-expanded', String(!isOpen));
        });
    });
}
