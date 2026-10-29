import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownLeft, ArrowRight, ArrowUpRight, Check, ChevronRight, Disc3,
  Heart, House, LoaderCircle, Music2, Search, Sparkles, X
} from 'lucide-react';
import { requestTracks } from './api.js';

const EXAMPLE = 'Что-то похожее на Linkin Park, но с женским вокалом';
const EXAMPLES = [EXAMPLE, 'Энергичный рок', 'Танцевальная музыка'];
const GENRES = [['Все треки', 'all'], ['Рок', 'rock'], ['Метал', 'metal'], ['Поп', 'pop'], ['Танцевальная', 'dance']];
const STORAGE_KEY = 'spoti-chan:favorites:v1';
// Decorative character art, not the artists' official album covers.
const TRACK_ART = {
  '1': '/assets/chan-crystal.png',
  '2': '/assets/chan-headphones.png',
  '3': '/assets/chan-violet.png',
  '4': '/assets/chan-electric.png'
};
const VOCALS = { female: 'Женский вокал', male: 'Мужской вокал' };
const TAGS = { rock: 'Рок', metal: 'Метал', alternative: 'Альтернатива', energetic: 'Энергичный', symphonic: 'Симфонический', pop: 'Поп', funk: 'Фанк', dance: 'Танцевальный' };

function readFavorites() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(stored) || !stored.every(id => typeof id === 'string')) throw new Error();
    return { ids: [...new Set(stored)], warning: '' };
  } catch {
    return { ids: [], warning: 'Не удалось прочитать избранное. Сохранение в браузере может быть недоступно.' };
  }
}

function routeFromHash() {
  return { '#/finder': 'finder', '#/favorites': 'favorites' }[window.location.hash] || 'home';
}

function countTracks(count) {
  const last = count % 10;
  const suffix = count % 100 >= 11 && count % 100 <= 14 ? 'треков' : last === 1 ? 'трек' : last >= 2 && last <= 4 ? 'трека' : 'треков';
  return `${count} ${suffix}`;
}

function Artwork({ track, className = '' }) {
  return <div className={`artwork ${className}`} aria-hidden="true">
    <img className="artwork-image" src={TRACK_ART[track.id] || '/assets/chrome-world.jpg'} alt="" loading="lazy" decoding="async" />
    <div className="artwork-orbit" /><div className="artwork-orbit orbit-two" />
    <div className="artwork-center"><Disc3 size={35} strokeWidth={1} /></div>
    <span className="artwork-caption">SPOTI—CHAN<br />SOUND COLLECTION</span>
    <span className="artwork-number">0{track.id}</span>
    <span className="artwork-edition">CRYSTAL SERIES / 001</span>
  </div>;
}

function LikeButton({ track, favorites, toggleFavorite }) {
  const liked = favorites.includes(track.id);
  return <button type="button" className={`icon-button like-button ${liked ? 'is-liked' : ''}`}
    aria-label={`${liked ? 'Убрать из избранного' : 'В избранное'}: ${track.title}`}
    aria-pressed={liked} onClick={() => toggleFavorite(track.id)}>
    <Heart size={19} fill={liked ? 'currentColor' : 'none'} />
  </button>;
}

function EmptyState({ icon: Icon = Search, title, children }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={28} /></span>
    <h3>{title}</h3><p>{children}</p></div>;
}

function TrackGrid({ tracks, favorites, toggleFavorite, onSelect }) {
  return <div className="track-grid">{tracks.map(track => <article className="track-card" key={track.id}>
    <button className="artwork-button" onClick={() => onSelect(track)} aria-label={`Подробнее: ${track.title} — ${track.artist}`}>
      <Artwork track={track} /><span className="artwork-action"><ArrowUpRight size={24} /></span>
    </button>
    <div className="track-card-info"><div className="min-w-0">
      <button className="track-name" onClick={() => onSelect(track)}>{track.title}</button>
      <p className="track-artist">{track.artist}</p>
    </div><LikeButton {...{ track, favorites, toggleFavorite }} /></div>
    <span className="track-genre">{TAGS[track.tags[0]] || track.tags[0]}<span>·</span>{VOCALS[track.vocals]}</span>
  </article>)}</div>;
}

function Finder({ favorites, toggleFavorite, onSelect }) {
  const [description, setDescription] = useState('');
  const [results, setResults] = useState(null);
  const [submitted, setSubmitted] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef(null);
  const input = useRef(null);
  useEffect(() => () => request.current?.abort(), []);

  async function find(event) {
    event.preventDefault();
    const query = description.trim();
    if (!query || busy) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError(''); setResults(null); setSubmitted(query);
    try {
      const tracks = await requestTracks('/api/finder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: query }), signal: controller.signal
      });
      setResults(tracks);
    } catch (error) {
      if (error.name !== 'AbortError') setError(error.message);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function reset() {
    request.current?.abort();
    setBusy(false); setResults(null); setSubmitted(''); setError(''); setDescription('');
    input.current?.focus();
  }

  return <>
    <div className="page-heading illustrated-heading"><img className="section-portrait" src="/assets/chan-headphones.png" alt="" decoding="async" /><span className="eyebrow"><Sparkles size={14} /> MUSIC FINDER</span>
      <h1>Помнишь вайб.<br /><span className="text-accent">Найдём трек.</span></h1>
      <p>Название вылетело из головы? Опиши, что хочется услышать.</p>
    </div>
    <section className="finder-panel" aria-labelledby="finder-label">
      <form onSubmit={find}>
        <label id="finder-label" htmlFor="description">Какую музыку ищем?</label>
        <textarea ref={input} id="description" value={description} maxLength={500} rows={3}
          onChange={event => setDescription(event.target.value)} placeholder={EXAMPLE}
          aria-describedby="finder-help finder-limit" disabled={busy} />
        <div className="finder-form-bottom"><span id="finder-limit" className="muted">{description.length} / 500</span>
          <button className="button button-primary" disabled={!description.trim() || busy}>
            {busy ? <LoaderCircle className="animate-spin" size={18} /> : <Sparkles size={18} />}
            {busy ? 'Ищем совпадения…' : 'Найти музыку'}{!busy && <ArrowRight size={18} />}
          </button></div>
      </form>
      <div className="prompt-examples"><span>Попробуй:</span>{EXAMPLES.map((example, index) =>
        <button key={example} disabled={busy} onClick={() => { setDescription(example); input.current?.focus(); }}>
          {index === 0 ? 'Linkin Park + женский вокал' : example}<ArrowUpRight size={13} />
        </button>)}</div>
      <p id="finder-help" className="demo-note"><span className="status-dot" />Деморежим: подбор по жанрам и тегам. Gemini подключим на следующем этапе.</p>
    </section>
    <section className="finder-results" aria-labelledby="results-title" aria-busy={busy}>
      <div className="section-heading"><div><span className="eyebrow">ТВОИ СОВПАДЕНИЯ</span>
        <h2 id="results-title">{results === null ? 'Музыка ближе, чем кажется' : results.length ? 'Нашлось по твоему описанию' : 'Поищем по-другому?'}</h2></div>
        {(results !== null || error || busy) && <button className="text-button" onClick={reset}>Сбросить<X size={15} /></button>}
      </div>
      <div role="status" className="sr-only">{busy ? 'Ищем треки' : results !== null ? `Найдено: ${countTracks(results.length)}` : ''}</div>
      {error && <div className="error-banner" role="alert">{error}<span>Текст сохранён — нажми «Найти музыку», чтобы повторить.</span></div>}
      {busy ? <div className="loading-state"><LoaderCircle className="animate-spin" size={24} />Подбираем треки…</div>
        : results === null && !error ? <EmptyState icon={AudioLinesIcon} title="Начни с пары слов">Жанр, исполнитель или тип вокала — опиши свой вайб, а мы поищем совпадения в каталоге.</EmptyState>
        : results?.length === 0 ? <EmptyState title="Пока без совпадений">Попробуй «рок», «танцевальная музыка» или один из примеров выше. В демокаталоге всего четыре трека.</EmptyState>
        : results && <><p className="results-query">{countTracks(results.length)} по запросу «{submitted}»</p>
          <div className="result-list">{results.map((track, index) => <article className="result-row" key={track.id}>
            <span className="row-number">{String(index + 1).padStart(2, '0')}</span>
            <button className="result-track" onClick={() => onSelect(track)}>
              <Artwork track={track} className="small-artwork" /><span><strong>{track.title}</strong><span className="track-artist">{track.artist}</span></span>
            </button>
            <div className="result-tags">{(track.matchedTags || []).map(tag => <span className="tag matched" key={tag}><Check size={11} />{TAGS[tag] || tag}</span>)}<span className="tag">{VOCALS[track.vocals]}</span></div>
            <LikeButton {...{ track, favorites, toggleFavorite }} />
          </article>)}</div></>}
    </section>
  </>;
}

function AudioLinesIcon({ size = 28 }) {
  return <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M4 12v4m5-9v14m5-18v22m5-17v12m5-9v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
}

function TrackDialog({ track, close, favorites, toggleFavorite }) {
  const dialog = useRef(null);
  useEffect(() => { dialog.current.showModal(); }, []);
  return <dialog ref={dialog} className="track-dialog" onClose={close}
    onClick={event => { if (event.target === dialog.current) dialog.current.close(); }} aria-labelledby="detail-title">
    <button className="icon-button dialog-close" onClick={() => dialog.current.close()} aria-label="Закрыть"><X /></button>
    <Artwork track={track} className="detail-artwork" />
    <span className="eyebrow">ИЗ КОЛЛЕКЦИИ SPOTI-CHAN</span><h2 id="detail-title">{track.title}</h2>
    <p className="detail-artist">{track.artist}</p>
    <div className="detail-tags">{track.tags.map(tag => <span className="tag" key={tag}>{TAGS[tag] || tag}</span>)}<span className="tag">{VOCALS[track.vocals]}</span></div>
    <button className="button button-primary w-full" onClick={() => toggleFavorite(track.id)}>
      <Heart size={18} fill={favorites.includes(track.id) ? 'currentColor' : 'none'} />
      {favorites.includes(track.id) ? 'Убрать из избранного' : 'Добавить в избранное'}
    </button>
    <p className="detail-note">Пока здесь только информация о треке. Воспроизведение появится после подключения музыкального API.</p>
  </dialog>;
}

export default function App() {
  const [route, setRoute] = useState(routeFromHash);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState('');
  const [genre, setGenre] = useState('all');
  const [saved, setSaved] = useState(readFavorites);
  const [selected, setSelected] = useState(null);
  const page = useRef(null);

  useEffect(() => {
    function navigate() { setRoute(routeFromHash()); setSearch(''); setGenre('all'); }
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);

  useEffect(() => {
    page.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    document.title = `${{ home: 'Обзор', finder: 'Music Finder', favorites: 'Избранное' }[route]} — Spoti-Chan`;
  }, [route]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    requestTracks('/api/tracks', { signal: controller.signal }).then(setCatalog).catch(error => {
      if (error.name !== 'AbortError') setError(error.message);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);

  function toggleFavorite(id) {
    const ids = saved.ids.includes(id) ? saved.ids.filter(item => item !== id) : [...saved.ids, id];
    let warning = '';
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ids)); }
    catch { warning = 'Избранное обновлено только на время этой сессии: браузер не разрешил сохранение.'; }
    setSaved({ ids, warning });
  }

  const visible = catalog.filter(track => (route !== 'favorites' || saved.ids.includes(track.id)) &&
    (genre === 'all' || track.tags.includes(genre)) &&
    `${track.title} ${track.artist}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const favoriteCount = catalog.filter(track => saved.ids.includes(track.id)).length;
  const nav = [
    { id: 'home', href: '#/', title: 'Обзор', icon: House },
    { id: 'finder', href: '#/finder', title: 'Music Finder', icon: Sparkles },
    { id: 'favorites', href: '#/favorites', title: 'Избранное', icon: Heart }
  ];

  return <div className="app-shell">
    <a className="skip-link" href="#main" onClick={event => { event.preventDefault(); page.current?.focus(); page.current?.scrollIntoView(); }}>К содержимому</a>
    <aside className="sidebar">
      <a className="brand" href="#/" aria-label="Spoti-Chan — обзор"><span className="brand-icon"><img src="/assets/chan-avatar.png" alt="" width="44" height="44" /></span><span className="brand-name">spoti<span className="brand-light">chan</span><span className="brand-period">✦</span></span></a>
      <span className="nav-label">ТВОЁ ПРОСТРАНСТВО</span>
      <nav aria-label="Основная навигация">{nav.map(({ id, href, title, icon: Icon }) => <a key={id} href={href} aria-current={route === id ? 'page' : undefined} className={`nav-item ${route === id ? 'active' : ''}`}>
        <Icon size={20} /><span>{title}</span>{id === 'finder' && <span className="nav-ai">AI</span>}
        {id === 'favorites' && favoriteCount > 0 && <span className="nav-count">{favoriteCount}</span>}
      </a>)}</nav>
      <div className="sidebar-collection"><img className="collection-portrait" src="/assets/chan-violet.png" alt="" loading="lazy" /><div className="collection-icon"><Heart size={22} /></div><h3>Только твой вайб</h3><p>Сохраняй находки —<br />пусть будут под рукой.</p><a href="#/favorites">Моя коллекция<ArrowUpRight size={16} /></a></div>
      <div className="sidebar-footer"><span className="sidebar-record"><Disc3 size={24} /></span><div>Made for discovery.<span>Учебный проект · v0.2</span></div></div>
    </aside>

    <main id="main" tabIndex={-1} ref={page} className="main-content">
      <header className="topbar"><div className="breadcrumbs"><span className="breadcrumb-root">Твоя музыка</span><ChevronRight size={14} /><span>{nav.find(item => item.id === route).title}</span></div>
        <div className="topbar-identity"><span className="demo-badge"><span className="status-dot" />DEMO CATALOG</span><img className="chan-icon" src="/assets/chan-avatar.png" alt="Иконка Spoti-Chan" width="36" height="36" /></div>
      </header>
      <div className="page-content">
        {saved.warning && <p className="storage-warning" role="status">{saved.warning}</p>}
        {route === 'finder' ? <Finder favorites={saved.ids} toggleFavorite={toggleFavorite} onSelect={setSelected} /> : <>
          {route === 'home' ? <>
            <div className="welcome-line"><span className="eyebrow">МЕНЬШЕ ПОИСКОВ. БОЛЬШЕ МУЗЫКИ.</span><span className="edition">CHROME EDITION / 001</span></div>
            <section className="hero" aria-labelledby="hero-title">
              <img className="hero-chrome" src="/assets/chrome-world.jpg" alt="" fetchPriority="high" />
              <div className="hero-copy"><span className="hero-kicker"><span />ЗА ПРЕДЕЛАМИ ПРИВЫЧНОГО</span><h1 id="hero-title">Красивая музыка<br /><span>Красивые тян</span></h1><p>Опиши настроение. Вспомни звучание.<br />Открой музыку, которую искал.</p><a className="button button-primary" href="#/finder"><Sparkles size={18} />Открыть Music Finder<ArrowUpRight size={18} /></a></div>
              <div className="hero-visual" aria-hidden="true"><span className="chrome-star">✧</span><span className="frequency-mark">01—∞</span><span className="visual-caption">FIND YOUR FREQUENCY</span></div>
              <div className="hero-bottom" aria-hidden="true"><span>SPOTI—CHAN / SOUND EXPLORATION</span><span>音楽でつながる <span className="hero-cross">✦</span></span></div>
            </section>
            <a className="finder-shortcut" href="#/finder"><span className="shortcut-icon"><ArrowDownLeft size={24} /></span><div><strong>«Как Linkin Park, но с женским вокалом»</strong><span>Да, так тоже можно искать. Попробуй Music Finder.</span></div><ArrowRight size={20} /></a>
          </> : <div className="page-heading favorites-heading illustrated-heading"><img className="section-portrait" src="/assets/chan-electric.png" alt="" decoding="async" /><span className="eyebrow"><Heart size={14} /> ТВОЯ КОЛЛЕКЦИЯ</span><h1>На повторе.<br /><span className="text-accent">В твоём сердце.</span></h1><p>Любимые находки, сохранённые в этом браузере.</p></div>}

          <section className="catalog-section" aria-labelledby="catalog-title" aria-busy={loading}>
            <div className="section-heading"><div><span className="eyebrow">{route === 'home' ? 'МАЛЕНЬКАЯ КОЛЛЕКЦИЯ, БОЛЬШОЙ ВАЙБ' : 'СОХРАНЕНО ТОБОЙ'}</span><h2 id="catalog-title">{route === 'home' ? 'Открой для себя' : 'Избранные треки'}<span className="count-badge">{loading || error ? '—' : visible.length}</span></h2></div>
              <label className="catalog-search"><Search size={17} /><span className="sr-only">Поиск по названию или исполнителю</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Трек или исполнитель" /></label>
            </div>
            <div className="genre-filters" aria-label="Фильтр по жанру">{GENRES.map(([label, value]) => <button key={value} className={`genre-chip ${genre === value ? 'selected' : ''}`} aria-pressed={genre === value} onClick={() => setGenre(value)}>{label}</button>)}</div>
            <div className="sr-only" role="status">{loading ? 'Загружаем каталог' : error ? '' : `Показано: ${countTracks(visible.length)}`}</div>
            {loading ? <div className="loading-state"><LoaderCircle className="animate-spin" size={24} />Загружаем музыку…</div> : error ? <div className="error-banner" role="alert">{error}<button className="text-button" onClick={() => setAttempt(value => value + 1)}>Попробовать снова<ArrowRight size={15} /></button></div>
              : visible.length > 0 ? <TrackGrid tracks={visible} favorites={saved.ids} toggleFavorite={toggleFavorite} onSelect={setSelected} />
              : <EmptyState icon={route === 'favorites' && !favoriteCount ? Heart : Search} title={route === 'favorites' && !favoriteCount ? 'Здесь будут твои находки' : 'Ничего не нашлось'}>{route === 'favorites' && !favoriteCount ? <>Нажми сердечко рядом с треком в <a href="#/">каталоге</a> или Music Finder.</> : 'Попробуй другое название или выбери «Все треки».'}</EmptyState>}
          </section>
        </>}
        <footer className="page-footer"><span><Music2 size={14} />Spoti-Chan<span className="footer-divider">/</span>Музыка начинается с любопытства</span><span>Демо · без воспроизведения</span></footer>
      </div>
    </main>
    {selected && <TrackDialog track={selected} close={() => setSelected(null)} favorites={saved.ids} toggleFavorite={toggleFavorite} />}
  </div>;
}
