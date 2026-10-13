/** Hand the browser a file to save (a phone shows its usual download or share sheet). */
export function saveFile(name: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  // (after the download has started)
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
