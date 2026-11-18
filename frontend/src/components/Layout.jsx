import { Box, Chip, IconButton, Tooltip, Typography } from '@mui/material';
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded';
import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import BiotechRoundedIcon from '@mui/icons-material/BiotechRounded';
import HubRoundedIcon from '@mui/icons-material/HubRounded';
import { NavLink, useLocation } from 'react-router-dom';
import { colors } from '../theme';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';

const NAV = [
  { to: '/', label: 'Overview', icon: <DashboardRoundedIcon /> },
  { to: '/map', label: 'Ocean map', icon: <PublicRoundedIcon /> },
  { to: '/biodiversity', label: 'Biodiversity (eDNA)', icon: <BiotechRoundedIcon /> },
  { to: '/sources', label: 'Data sources', icon: <HubRoundedIcon /> },
];
const TITLES = { '/': 'Overview', '/map': 'Ocean map', '/biodiversity': 'Biodiversity and eDNA', '/sources': 'Data sources' };

function Logo() {
  return (
    <svg width="34" height="34" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M32 6 54 15v15c0 14-9.3 24-22 28C19.3 54 10 44 10 30V15Z" fill="rgba(6,182,212,0.12)" stroke={colors.cyan} strokeWidth="3.5" />
      <path d="M19 33c4.3-4.3 8.7-4.3 13 0s8.7 4.3 13 0M19 41c4.3-4.3 8.7-4.3 13 0s8.7 4.3 13 0" fill="none" stroke={colors.cyanLight} strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}

export default function Layout({ children }) {
  const { pathname } = useLocation();
  const health = useApi(() => api.health(), [], 30000);
  const ok = health.data && health.data.status === 'ok';
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Box component="nav" sx={{
        width: 72, flexShrink: 0, position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 1200,
        bgcolor: '#0d1322', borderRight: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column', alignItems: 'center', py: 1.5, gap: 1,
      }}>
        <Box sx={{ mb: 1.5 }}><Logo /></Box>
        {NAV.map((n) => (
          <Tooltip key={n.to} title={n.label} placement="right">
            <IconButton component={NavLink} to={n.to} end aria-label={n.label} sx={{
              width: 48, height: 48, borderRadius: 2.5, color: colors.muted,
              '&.active': { color: colors.cyan, bgcolor: 'rgba(6,182,212,0.14)', boxShadow: `inset 3px 0 0 ${colors.cyan}` },
              '&:hover': { color: colors.text, bgcolor: 'rgba(148,163,184,0.08)' },
            }}>{n.icon}</IconButton>
          </Tooltip>
        ))}
      </Box>
      <Box sx={{ flex: 1, ml: '72px', minWidth: 0 }}>
        <Box component="header" sx={{
          position: 'sticky', top: 0, zIndex: 1100, height: 60, px: 3, display: 'flex', alignItems: 'center', gap: 2,
          bgcolor: 'rgba(10,15,26,0.85)', backdropFilter: 'blur(10px)', borderBottom: `1px solid ${colors.border}`,
        }}>
          <Box>
            <Typography sx={{ fontWeight: 700, fontSize: 15, letterSpacing: '0.02em' }}>
              TRUSTED OCEAN <Box component="span" sx={{ color: colors.faint, fontWeight: 500 }}>/ {TITLES[pathname] || ''}</Box>
            </Typography>
            <Typography variant="caption" color="text.secondary">Verified ocean observations from open data</Typography>
          </Box>
          <Box sx={{ flex: 1 }} />
          <Chip size="small" label={ok ? 'Live' : health.loading && !health.data ? 'Connecting' : 'Backend offline'}
            sx={{
              fontWeight: 600, bgcolor: ok ? 'rgba(16,185,129,0.14)' : 'rgba(239,68,68,0.14)', color: ok ? colors.green : colors.red,
              '&::before': { content: '""', width: 8, height: 8, borderRadius: '50%', bgcolor: 'currentColor', ml: 1, animation: ok ? 'pulse 2s infinite' : 'none' },
              '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.35 } },
            }} />
        </Box>
        <Box component="main" sx={{ p: 3, maxWidth: 1680, mx: 'auto' }}>{children}</Box>
      </Box>
    </Box>
  );
}
