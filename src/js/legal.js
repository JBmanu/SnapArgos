/**
 * legal.js — Collapsible sections for the legal page
 */
export function initLegal() {
    document.querySelectorAll('.legal-section').forEach(section => {
        const head = section.querySelector('.legal-section-head');
        const body = section.querySelector('.legal-section-body');
        if (!head || !body) return;

        // Set initial natural height so the transition works
        body.style.maxHeight = body.scrollHeight + 'px';

        head.addEventListener('click', e => {
            // Don't collapse when clicking the download button
            if (e.target.closest('.legal-download-btn')) return;

            const isOpen = !section.classList.contains('collapsed');
            if (isOpen) {
                body.style.maxHeight = '0px';
                section.classList.add('collapsed');
            } else {
                body.style.maxHeight = body.scrollHeight + 'px';
                section.classList.remove('collapsed');
            }
        });
    });
}

