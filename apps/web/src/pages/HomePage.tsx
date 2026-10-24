import { Link } from 'react-router-dom';
import { Button } from '../components/Button';

export function HomePage() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: '2rem',
      }}
    >
      <div className="stage-enter" style={{ maxWidth: 720, width: '100%' }}>
        <p
          style={{
            fontSize: 11,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: varMuted(),
            marginBottom: 12,
          }}
        >
          Live venue trivia
        </p>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(3rem, 10vw, 5.5rem)',
            lineHeight: 0.95,
            margin: '0 0 1rem',
            fontWeight: 700,
          }}
        >
          Quizzical
        </h1>
        <p style={{ color: 'var(--ink-muted)', fontSize: '1.15rem', maxWidth: 420 }}>
          Wallboard, host console, and team phones — synchronised for in-person
          nights.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 32 }}>
          <Link to="/host/login">
            <Button withArrow>Host console</Button>
          </Link>
          <Link to="/play/DEMO01">
            <Button variant="ghost">Join as team</Button>
          </Link>
        </div>
        <p
          style={{
            marginTop: 20,
            fontSize: 13,
            color: 'var(--ink-muted)',
            maxWidth: 420,
          }}
        >
          Wallboard opens from the host console (Preview wall / Test) with the
          event token.
        </p>
      </div>
    </main>
  );
}

function varMuted() {
  return 'var(--ink-muted)';
}
