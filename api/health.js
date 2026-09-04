import { method } from './_lib/supabase.js';
export default function handler(req, res) { if (!method(req, res, ['GET'])) return; res.status(200).json({ ok: true }); }
