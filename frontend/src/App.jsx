import { Route, Routes, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Overview from './pages/Overview';
import MapPage from './pages/MapPage';
import Biodiversity from './pages/Biodiversity';
import Sources from './pages/Sources';
import Trust from './pages/Trust';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/biodiversity" element={<Biodiversity />} />
        <Route path="/trust" element={<Trust />} />
        <Route path="/sources" element={<Sources />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
