import { useEffect, useRef, useState } from 'react';
import { api, type SearchResult } from '../api';
import { formatBytes } from '../utils';

const DEBOUNCE_MS = 350;

export function SearchPanel() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      setSearching(false);
      setError(null);
      return;
    }
    setSearching(true);
    debounceRef.current = window.setTimeout(async () => {
      const requestId = ++requestIdRef.current;
      try {
        const { results: found } = await api.searchFiles(query.trim());
        if (requestId === requestIdRef.current) {
          setResults(found);
          setError(null);
        }
      } catch (err) {
        if (requestId === requestIdRef.current) setError((err as Error).message);
      } finally {
        if (requestId === requestIdRef.current) setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query]);

  return (
    <section>
      <div className="panel-header">
        <div>
          <p className="eyebrow">File search</p>
          <h2>Locate assets quickly</h2>
        </div>
      </div>
      <div className="search-box">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name across Desktop, Documents, Downloads…" />
      </div>

      {error && <p className="hint-text hint-error">{error}</p>}
      {!error && searching && <p className="hint-text">Scanning…</p>}
      {!error && !searching && query.trim() && results.length === 0 && <p className="hint-text">No matches found.</p>}

      <div className="search-results">
        {results.map((result) => (
          <div key={result.path} className="search-result-row">
            <div className="search-result-info">
              <span className="search-result-name">{result.isDirectory ? '📁' : '📄'} {result.name}</span>
              <small title={result.path}>{result.path}</small>
            </div>
            <div className="search-result-actions">
              {!result.isDirectory && <small>{formatBytes(result.size)}</small>}
              <button className="ghost-button" onClick={() => api.openSearchResult(result.path, false)}>
                Open
              </button>
              <button className="ghost-button" onClick={() => api.openSearchResult(result.path, true)}>
                Reveal
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
