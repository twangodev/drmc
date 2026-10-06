try {
  const preference = localStorage.getItem('drmc-theme')
  document.documentElement.dataset.theme = preference === 'light' ? 'light' : 'dark'
} catch {
  document.documentElement.dataset.theme = 'dark'
}
