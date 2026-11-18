import { useMemo, useState } from 'react';
import {
  Alert, Box, Chip, CircularProgress, Grid, Link, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import Section from '../components/Section';
import OceanMap, { toFeatures } from '../components/OceanMap';
import { RampLegend } from '../components/Legend';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';
import { colors } from '../theme';
import { KINGDOM_COLORS, fmtNumber, fmtTime } from '../lib/format';

// Indian Ocean focus area (same as the OBIS collector setting)
const BBOX = '30,-40,120,30';
const BOUNDS = [[30, -40], [120, 30]];
const RICHNESS = [[1, '#0ea5e9'], [10, '#06b6d4'], [50, '#10b981'], [150, '#facc15'], [400, '#f97316']];
const italic = (rank) => rank === 'species' || rank === 'genus';

function TaxaTable({ rows, selected, onSelect }) {
  return (
    <Table size="small" stickyHeader>
      <TableHead>
        <TableRow><TableCell>Taxon</TableCell><TableCell>Group</TableCell><TableCell align="right">Records</TableCell></TableRow>
      </TableHead>
      <TableBody>
        {rows.map((t) => (
          <TableRow key={t.aphia_id} hover={!!onSelect} selected={selected === t.aphia_id}
            onClick={onSelect ? () => onSelect(t) : undefined} sx={{ cursor: onSelect ? 'pointer' : 'default' }}>
            <TableCell>
              <Typography sx={{ fontSize: 13, fontStyle: italic(t.rank) ? 'italic' : 'normal' }}>{t.scientific_name}</Typography>
              <Typography variant="caption" color="text.secondary">{t.rank || ''}</Typography>
            </TableCell>
            <TableCell>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: KINGDOM_COLORS[t.kingdom] || '#94a3b8' }} />
                <Typography variant="caption">{t.phylum || t.kingdom || '-'}</Typography>
              </Box>
            </TableCell>
            <TableCell align="right">{fmtNumber(t.records)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function SitePanel({ site, onClose }) {
  const taxa = useApi(() => api.site({ lon: site.lon, lat: site.lat }), [site.lon, site.lat]);
  return (
    <Section sx={{ mt: 2 }} title={`Sampling site ${site.lat.toFixed(3)}°, ${site.lon.toFixed(3)}°`}
      subtitle={`${fmtNumber(site.records)} records, ${fmtNumber(site.taxa)} taxa, sampled ${fmtTime(site.first).slice(0, 10)} to ${fmtTime(site.last).slice(0, 10)}`}
      action={<Chip size="small" label="Close" onClick={onClose} variant="outlined" />}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Datasets: {(site.datasets || []).filter(Boolean).join('; ')}
      </Typography>
      {taxa.loading && !taxa.data && <CircularProgress size={20} />}
      {taxa.data && <Box sx={{ maxHeight: 420, overflow: 'auto' }}><TaxaTable rows={taxa.data.taxa.slice(0, 50)} /></Box>}
    </Section>
  );
}

export default function Biodiversity() {
  const [taxon, setTaxon] = useState(null);
  const [site, setSite] = useState(null);
  const taxa = useApi(() => api.taxa({ bbox: BBOX, limit: 50 }), [], 300000);
  const sites = useApi(() => api.sites({ bbox: BBOX, aphia_id: taxon ? taxon.aphia_id : undefined }), [taxon], 300000);
  const datasets = useApi(() => api.datasets({ bbox: BBOX }), [], 300000);
  const siteRows = sites.data ? sites.data.sites : [];
  const totalRecords = siteRows.reduce((n, x) => n + x.records, 0);

  const layers = useMemo(() => [{
    id: 'sites',
    data: toFeatures(siteRows, 'lon', 'lat', (x) => ({ i: siteRows.indexOf(x), n: x.records, t: x.taxa })),
    color: taxon ? colors.amber : ['interpolate', ['linear'], ['get', 't'], ...RICHNESS.flat()],
    radiusExpr: ['interpolate', ['linear'], ['ln', ['+', ['get', 'n'], 1]], 0, 4, 4, 8, 10, 22],
    opacity: 0.85,
  }], [siteRows, taxon]);

  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined" sx={{ borderColor: colors.border }}>
        Environmental DNA (eDNA) detections published to OBIS for the Indian Ocean (30°E to 120°E, 40°S to 30°N), last 5 years.
        Species names are checked against WoRMS. Only datasets with commercial-use licences (CC0, CC BY) are included.
      </Alert>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 8 }}>
          <Section
            title={taxon ? `Where ${taxon.scientific_name} was detected` : 'eDNA sampling sites'}
            subtitle={`${fmtNumber(siteRows.length)} sites, ${fmtNumber(totalRecords)} records. Circle size = records, colour = number of taxa. Click a site for its species.`}
            action={taxon
              ? <Chip label={`${taxon.scientific_name}  ✕`} onClick={() => setTaxon(null)} color="warning" variant="outlined" />
              : <RampLegend ramp={RICHNESS} unit="taxa" />}
          >
            {sites.error && <Alert severity="error" sx={{ mb: 1 }}>Cannot load eDNA sites.</Alert>}
            <Box sx={{ position: 'relative' }}>
              {sites.loading && <CircularProgress size={22} sx={{ position: 'absolute', top: 12, left: 12, zIndex: 2 }} />}
              <OceanMap layers={layers} height={560} fitBounds={BOUNDS} onSelect={(f) => setSite(siteRows[f.properties.i])} />
            </Box>
          </Section>
          {site && <SitePanel key={`${site.lon},${site.lat}`} site={site} onClose={() => setSite(null)} />}
        </Grid>
        <Grid size={{ xs: 12, lg: 4 }}>
          <Section title="Most detected taxa" subtitle="Click a row to map only that taxon" sx={{ height: '100%' }}>
            {taxa.loading && !taxa.data && <CircularProgress size={22} />}
            <Box sx={{ maxHeight: 600, overflow: 'auto' }}>
              <TaxaTable rows={taxa.data ? taxa.data.taxa : []} selected={taxon && taxon.aphia_id} onSelect={(t) => { setTaxon(t); setSite(null); }} />
            </Box>
          </Section>
        </Grid>
      </Grid>
      <Section title="Scientific datasets" subtitle="Each record is credited to the dataset that published it">
        <Table size="small">
          <TableHead><TableRow><TableCell>Dataset</TableCell><TableCell>Sampled</TableCell><TableCell>Licence</TableCell><TableCell align="right">Records</TableCell></TableRow></TableHead>
          <TableBody>
            {(datasets.data ? datasets.data.datasets : []).map((d) => (
              <TableRow key={d.dataset_id}>
                <TableCell><Link href={`https://obis.org/dataset/${d.dataset_id}`} target="_blank" rel="noopener noreferrer" underline="hover" color="inherit">{d.title || d.dataset_id}</Link></TableCell>
                <TableCell><Typography variant="caption" color="text.secondary">{fmtTime(d.first).slice(0, 10)} to {fmtTime(d.last).slice(0, 10)}</Typography></TableCell>
                <TableCell><Chip size="small" label={d.licence} sx={{ bgcolor: 'rgba(16,185,129,0.12)', color: colors.green }} /></TableCell>
                <TableCell align="right">{fmtNumber(d.records)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
    </Stack>
  );
}
