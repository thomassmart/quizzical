import { Navigate, Route, Routes } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { HostLogin } from './pages/host/HostLogin';
import { HostHome } from './pages/host/HostHome';
import { HostEventPrep } from './pages/host/HostEventPrep';
import { HostLive } from './pages/host/HostLive';
import { WallPage } from './pages/wall/WallPage';
import { PlayPage } from './pages/play/PlayPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/host/login" element={<HostLogin />} />
      <Route path="/host" element={<HostHome />} />
      <Route path="/host/events/:eventId" element={<HostEventPrep />} />
      <Route path="/host/events/:eventId/live" element={<HostLive />} />
      <Route path="/wall/:eventCode" element={<WallPage />} />
      <Route path="/play/:eventCode" element={<PlayPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
