import { useEffect, useRef, useState } from 'react';
import { SkipForward, X } from 'lucide-react';

export default function Player({ track, onClose, onNext, hasNext }) {
  const audio = useRef(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setError('');
    audio.current?.play().catch(error => { if (!cancelled && error.name !== 'AbortError') setError('Нажми Play для запуска. Если аудио недоступно, выбери другой трек.'); });
    return () => { cancelled = true; };
  }, [track.id]);
  return <section className="music-player" aria-label="Музыкальный плеер">
    <div className="player-title"><strong>{track.title}</strong><span>{track.artist}</span>
      <span className="player-attribution">{track.sourceUrl && <a href={track.sourceUrl} target="_blank" rel="noreferrer">Jamendo ↗</a>}{track.licenseUrl && <a href={track.licenseUrl} target="_blank" rel="noreferrer">Лицензия ↗</a>}</span>
    </div>
    <div className="player-controls"><audio ref={audio} src={track.audioUrl} controls controlsList="nodownload" preload="metadata" onEnded={hasNext ? onNext : undefined}
      onError={() => setError('Источник аудио недоступен. Попробуй другой трек.')} aria-label={`${track.title} — ${track.artist}`} />
      {error && <span className="player-error" role="status">{error}</span>}</div>
    <button className="icon-button" onClick={onNext} disabled={!hasNext} aria-label="Следующий трек"><SkipForward size={19} /></button>
    <button className="icon-button" onClick={onClose} aria-label="Закрыть плеер"><X size={19} /></button>
  </section>;
}
