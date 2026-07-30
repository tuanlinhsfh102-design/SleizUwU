import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout';
import { DashboardPage } from './pages/Dashboard';
import { ChannelsPage } from './pages/Channels';
import { MoviesPage } from './pages/Movies';
import { DownloadMediaPage } from './pages/DownloadMedia';
import { SettingsPage } from './pages/Settings';
import { MovieWorkspacePage } from './pages/MovieWorkspace';
import { VideoPage } from './pages/Video';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/channels" element={<ChannelsPage />} />
          <Route path="/movies" element={<MoviesPage />} />
          <Route path="/movies/:movieId" element={<MovieWorkspacePage />} />
          <Route path="/episodes" element={<Navigate to="/movies" replace />} />
          <Route path="/subtitle" element={<Navigate to="/movies" replace />} />
          <Route path="/video" element={<VideoPage />} />
          {/* Legacy /movie-translation now redirects to the new /video pipeline.
              The old 4-step manual workflow has been superseded by the
              automated upload → STT → translate → TTS → render pipeline. */}
          <Route path="/movie-translation" element={<Navigate to="/video" replace />} />
          <Route path="/download" element={<DownloadMediaPage />} />
          <Route path="/bilibili" element={<Navigate to="/download" replace />} />
          <Route path="/tiktok" element={<Navigate to="/download" replace />} />
          <Route path="/ai" element={<Navigate to="/movies" replace />} />
          <Route path="/export" element={<Navigate to="/movies" replace />} />
          <Route path="/history" element={<Navigate to="/dashboard" replace />} />
          <Route path="/statistics" element={<Navigate to="/dashboard" replace />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
