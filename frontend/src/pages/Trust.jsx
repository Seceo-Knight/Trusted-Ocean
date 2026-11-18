import { useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Collapse, Grid, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import VerifiedRoundedIcon from '@mui/icons-material/VerifiedRounded';
import KeyRoundedIcon from '@mui/icons-material/KeyRounded';
import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded';
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import KpiTile from '../components/KpiTile';
import Section from '../components/Section';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';
import { colors } from '../theme';
import { SOURCE_COLORS, SOURCE_NAMES, fmtAgo, fmtNumber, fmtTime } from '../lib/format';

function Check({ ok, label }) {
  return (
    <Chip size="small" label={`${ok ? '✓' : '✕'} ${label}`}
      sx={{ bgcolor: ok ? 'rgba(16,185,129,0.14)' : 'rgba(239,68,68,0.14)', color: ok ? colors.green : colors.red, fontWeight: 600 }} />
  );
}

const shortCid = (c) => (c ? `${c.slice(0, 8)}…${c.slice(-6)}` : '');

function BatchRow({ b, gateway }) {
  const [state, setState] = useState({ open: false, loading: false, data: null, error: null });
  const verify = async () => {
    setState({ open: true, loading: true, data: null, error: null });
    try { setState({ open: true, loading: false, data: await api.trustBatch(b.id), error: null }); } catch (error) { setState({ open: true, loading: false, data: null, error }); }
  };
  const v = state.data && state.data.verification;
  return (
    <>
      <TableRow hover>
        <TableCell>#{b.id}</TableCell>
        <TableCell>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: SOURCE_COLORS[b.source_id] }} />{SOURCE_NAMES[b.source_id] || b.source_id}
          </Box>
        </TableCell>
        <TableCell><Typography variant="body2">{fmtTime(b.fetched_at)}</Typography><Typography variant="caption" color="text.secondary">{fmtAgo(b.fetched_at)}</Typography></TableCell>
        <TableCell align="right">{fmtNumber(b.records)}</TableCell>
        <TableCell>
          {b.signed
            ? <Chip size="small" label={b.sig_alg} sx={{ bgcolor: 'rgba(6,182,212,0.14)', color: colors.cyan, fontWeight: 600 }} />
            : <Chip size="small" label="not signed (before signing)" variant="outlined" sx={{ color: colors.faint }} />}
        </TableCell>
        <TableCell>
          {b.ipfs_cid
            ? <Chip size="small" component="a" clickable href={`${gateway}/ipfs/${b.ipfs_cid}/`} target="_blank" rel="noopener noreferrer"
                label={shortCid(b.ipfs_cid)} title={b.ipfs_cid} sx={{ fontFamily: 'monospace', bgcolor: 'rgba(139,92,246,0.14)', color: colors.purple }} />
            : b.signed ? <Chip size="small" label="pending" variant="outlined" sx={{ color: colors.amber }} /> : <Typography variant="caption" color="text.secondary">-</Typography>}
        </TableCell>
        <TableCell>
          {b.anchor_tx
            ? <Chip size="small" label={`block ${b.anchor_block || '?'}`} sx={{ bgcolor: 'rgba(16,185,129,0.14)', color: colors.green, fontWeight: 600 }} />
            : b.ipfs_cid ? <Chip size="small" label="pending" variant="outlined" sx={{ color: colors.amber }} /> : <Typography variant="caption" color="text.secondary">-</Typography>}
        </TableCell>
        <TableCell align="right">
          {b.signed && <Button size="small" variant="outlined" onClick={verify} disabled={state.loading}>{state.loading ? 'Checking' : 'Verify now'}</Button>}
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={8} sx={{ py: 0, borderBottom: state.open ? undefined : 'none' }}>
          <Collapse in={state.open} unmountOnExit>
            <Box sx={{ py: 2 }}>
              {state.loading && <CircularProgress size={20} />}
              {state.error && <Alert severity="error">{state.error.message}</Alert>}
              {v && (
                <Stack spacing={1.5}>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Typography sx={{ fontWeight: 700, color: v.verified ? colors.green : colors.red, mr: 1 }}>
                      {!v.verified ? 'NOT VERIFIED: data does not match its signature'
                        : state.data.fully_verified ? 'FULLY VERIFIED: signed, archived and anchored on the blockchain'
                          : 'VERIFIED: data is exactly as collected and signed'}
                    </Typography>
                    <Check ok={v.key_matches} label="signing key" />
                    <Check ok={v.signature_valid} label="post-quantum signature" />
                    <Check ok={v.records_match} label={`records fingerprint (${fmtNumber(state.data.manifest.envelope_count)} records)`} />
                    {state.data.archive && state.data.archive.archived
                      ? <Check ok={state.data.archive.records_match === true} label={state.data.archive.error ? 'IPFS archive unreachable' : 'IPFS archive copy matches'} />
                      : <Chip size="small" variant="outlined" label="not archived yet" sx={{ color: colors.amber }} />}
                    {state.data.anchor && state.data.anchor.anchored
                      ? <Check ok={state.data.anchor.cid_matches === true} label={`blockchain anchor (block ${state.data.anchor.on_chain.block_number})`} />
                      : <Chip size="small" variant="outlined" label={state.data.anchor && state.data.anchor.error ? 'blockchain unreachable' : 'not anchored yet'} sx={{ color: colors.amber }} />}
                  </Box>
                  {state.data.anchor && state.data.anchor.on_chain && state.data.anchor.on_chain.exists && (
                    <Typography variant="caption" color="text.secondary">
                      On-chain record: block {state.data.anchor.on_chain.block_number}, anchored {fmtTime(state.data.anchor.on_chain.anchored_at)}, contract{' '}
                      <Box component="span" sx={{ fontFamily: 'monospace', color: colors.green }}>{state.data.anchor.on_chain.contract}</Box>
                      {state.data.anchor.tx && <>, transaction <Box component="span" sx={{ fontFamily: 'monospace', color: colors.green }}>{state.data.anchor.tx.slice(0, 18)}…</Box></>}
                    </Typography>
                  )}
                  {state.data.archive && state.data.archive.dir_cid && (
                    <Typography variant="caption" color="text.secondary">
                      Archive CID <Box component="span" sx={{ fontFamily: 'monospace', color: colors.purple }}>{state.data.archive.dir_cid}</Box>, published {fmtTime(state.data.archive.published_at)}
                    </Typography>
                  )}
                  <Typography variant="caption" color="text.secondary">
                    Checked {fmtTime(state.data.checked_at)}. Signature {fmtNumber(state.data.signature_bytes)} bytes, key {state.data.public_key_id}.
                  </Typography>
                  <Box component="pre" sx={{ m: 0, p: 1.5, borderRadius: 2, bgcolor: '#0d1322', border: `1px solid ${colors.border}`, fontSize: 12, overflow: 'auto', color: colors.muted }}>
                    {JSON.stringify(state.data.manifest, null, 2)}
                  </Box>
                </Stack>
              )}
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

export default function Trust() {
  const summary = useApi(() => api.trustSummary(), [], 60000);
  const keys = useApi(() => api.trustKeys(), [], 300000);
  const batches = useApi(() => api.trustBatches({ limit: 40 }), [], 60000);
  const s = summary.data;
  const key = keys.data && keys.data.keys.length ? keys.data.keys[keys.data.keys.length - 1] : null;

  const downloadKey = () => {
    const blob = new Blob([JSON.stringify(key, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'trusted-ocean-signing-key.pub.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Stack spacing={2.5}>
      {(summary.error || batches.error) && <Alert severity="error">Cannot reach the trust API. Is the backend running?</Alert>}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6, lg: 'grow' }}><KpiTile icon={<VerifiedRoundedIcon fontSize="small" />} label="Signed batches" value={s ? fmtNumber(s.signed) : '-'} hint={s ? `of ${fmtNumber(s.batches)} in total, last ${s.last_signed ? fmtAgo(s.last_signed) : '-'}` : ''} accent={colors.green} /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 'grow' }}><KpiTile icon={<ShieldRoundedIcon fontSize="small" />} label="Algorithm" value="ML-DSA-65" hint="NIST FIPS 204, quantum-safe" /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 'grow' }}><KpiTile icon={<KeyRoundedIcon fontSize="small" />} label="Signing key" value={<Box component="span" sx={{ fontSize: 17, fontFamily: 'monospace' }}>{key ? key.key_id.replace('mldsa65:', '') : '-'}</Box>} hint={key ? `created ${fmtTime(key.created_at)}` : 'created on first signed batch'} accent={colors.purple} /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 'grow' }}><KpiTile icon={<Inventory2RoundedIcon fontSize="small" />} label="IPFS archive" value={s ? fmtNumber(s.archived) : '-'}
          hint={!s ? '' : !s.ipfs || !s.ipfs.enabled ? 'archive disabled' : s.ipfs.node && s.ipfs.node.online ? `node online, ${fmtNumber(s.pending_archive)} pending` : `node offline, ${fmtNumber(s.pending_archive)} pending`}
          accent={s && s.ipfs && s.ipfs.node && !s.ipfs.node.online ? colors.red : colors.amber} /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 'grow' }}><KpiTile icon={<LinkRoundedIcon fontSize="small" />} label="Blockchain anchors" value={s ? fmtNumber(s.anchored) : '-'}
          hint={!s || !s.chain ? '' : !s.chain.enabled ? 'anchoring disabled' : s.chain.online ? `Besu QBFT, block ${fmtNumber(s.chain.block_number)}, ${fmtNumber(s.pending_anchor)} pending` : `chain offline, ${fmtNumber(s.pending_anchor)} pending`}
          accent={s && s.chain && s.chain.enabled && !s.chain.online ? colors.red : colors.green} /></Grid>
      </Grid>

      <Section title="How verification works">
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 1100 }}>
          Every collection run produces a <b>manifest</b>: what was collected, from which provider, when, and SHA-256 fingerprints of the provider's
          original file and of our records. The manifest is signed with a post-quantum <b>ML-DSA-65</b> key that never leaves the server.
          Anyone holding the public key can check the signature. If even one value in the records is changed afterwards, the fingerprint
          no longer matches and verification fails. Each signed batch is also published to a private IPFS archive, where its address (CID) is
          itself a fingerprint of the content, so the archived copy can be checked independently. Finally, the manifest fingerprint and the
          archive CID are anchored on a private Hyperledger Besu blockchain, which gives a tamper-proof timestamp that cannot be rewritten later.
        </Typography>
        {key && (
          <Box sx={{ mt: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button variant="outlined" startIcon={<DownloadRoundedIcon />} onClick={downloadKey}>Download public key</Button>
            <Typography variant="caption" color="text.secondary">
              Auditors can verify offline: <Box component="code" sx={{ color: colors.cyanLight }}>npm run verify -- batch.manifest.json trusted-ocean-signing-key.pub.json</Box>
            </Typography>
          </Box>
        )}
      </Section>

      <Section title="Recent batches" subtitle="Click Verify now to re-check a batch against its signature and stored records">
        {batches.loading && !batches.data && <CircularProgress size={22} />}
        <Table size="small">
          <TableHead>
            <TableRow><TableCell>Batch</TableCell><TableCell>Source</TableCell><TableCell>Collected</TableCell><TableCell align="right">Records</TableCell><TableCell>Signature</TableCell><TableCell>IPFS archive</TableCell><TableCell>Blockchain</TableCell><TableCell /></TableRow>
          </TableHead>
          <TableBody>
            {(batches.data ? batches.data.batches : []).map((b) => <BatchRow key={b.id} b={b} gateway={(s && s.ipfs && s.ipfs.gateway_url) || 'http://127.0.0.1:8089'} />)}
          </TableBody>
        </Table>
      </Section>
    </Stack>
  );
}
