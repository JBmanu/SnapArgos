/**
 * legal.js — Collapsible sections for the legal page
 */
export function initLegal() {
    document.querySelectorAll('.legal-section').forEach(section => {
        const head = section.querySelector('.legal-section-head');
        if (!head) return;

        head.addEventListener('click', e => {
            // Don't collapse when clicking the download button
            console.log("CLIIICK")
            if (e.target.closest('.legal-download-btn')) return;

            const isOpen = !section.classList.contains('collapsed');
            section.classList.toggle('collapsed', isOpen);
            head.setAttribute('aria-expanded', String(!isOpen));
        });
    });
}
