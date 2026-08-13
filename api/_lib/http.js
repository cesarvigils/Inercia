import { adminAuth } from './firebase-admin.js';

export function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8').send(JSON.stringify(body));
}
export function method(req, res, allowed) {
  if (!allowed.includes(req.method)) { res.setHeader('Allow', allowed.join(', ')); json(res, 405, { error: 'Método no permitido.' }); return false; }
  return true;
}
export async function requireUser(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) throw Object.assign(new Error('Iniciá sesión para continuar.'), { status: 401 });
  return adminAuth.verifyIdToken(header.slice(7), true);
}
export function fail(res, error) {
  console.error(error);
  json(res, error.status || 500, { error: error.expose ? error.message : (error.status && error.status < 500 ? error.message : 'Error interno del servidor.') });
}
