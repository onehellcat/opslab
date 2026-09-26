document.querySelectorAll('[data-copy]').forEach((button) => {
  button.addEventListener('click', async () => {
    const original = button.textContent;
    await navigator.clipboard.writeText(button.dataset.copy);
    button.textContent = 'Copied ✓';
    window.setTimeout(() => { button.textContent = original; }, 1400);
  });
});

const progressButton = document.querySelector('#demo-progress');
const progressBar = document.querySelector('#progress-bar');
let progress = 38;

progressButton?.addEventListener('click', () => {
  progress = progress >= 100 ? 20 : Math.min(progress + 21, 100);
  progressBar.style.setProperty('--ops-progress', `${progress}%`);
  progressButton.querySelector('span').textContent = `${progress}%`;
});
