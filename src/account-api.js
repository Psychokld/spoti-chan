export async function accountRequest(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method, credentials: 'same-origin', cache: 'no-store', signal,
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('Сервер недоступен. Проверь подключение и попробуй ещё раз.');
  }
  let data;
  try { data = await response.json(); }
  catch { throw new Error('Сервер вернул неизвестный ответ. Попробуй ещё раз.'); }
  if (!response.ok) {
    const error = new Error(typeof data?.error === 'string' ? data.error : 'Не удалось выполнить действие. Попробуй ещё раз.');
    error.status = response.status;
    throw error;
  }
  return data;
}
