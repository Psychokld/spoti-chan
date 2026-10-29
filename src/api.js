export async function requestTracks(path, options = {}) {
  let response;
  try {
    response = await fetch(path, options);
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('Не удалось связаться с сервером. Проверь подключение и попробуй ещё раз.');
  }
  let data;
  try {
    data = await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('Сервер недоступен или вернул неверный ответ. Попробуй ещё раз.');
  }
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Не удалось загрузить треки. Попробуй ещё раз.');
  const valid = data && typeof data === 'object' && Array.isArray(data.tracks) && data.tracks.every(track =>
    track && typeof track === 'object' && typeof track.id === 'string' && typeof track.title === 'string' &&
    typeof track.artist === 'string' && ['male', 'female'].includes(track.vocals) &&
    Array.isArray(track.tags) && track.tags.every(tag => typeof tag === 'string') &&
    (track.matchedTags === undefined || (Array.isArray(track.matchedTags) &&
      track.matchedTags.every(tag => typeof tag === 'string'))));
  if (!valid) throw new Error('Сервер вернул каталог в неизвестном формате. Попробуй ещё раз.');
  return data.tracks;
}
