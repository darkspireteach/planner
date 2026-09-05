/* The published feed's address.
 *
 * Kept on its own so there is exactly one line to change if the endpoint moves.
 * No token: this reads only what has been published, which the endpoint has
 * already stripped of anything students may not see.
 *
 * If you ever redeploy, use Deploy ▸ Manage deployments ▸ New version rather
 * than Deploy ▸ New deployment — a new deployment issues a NEW url, and every
 * link you have posted in Schoology would stop working.
 */
const ENDPOINT =
  'https://script.google.com/macros/s/PASTE_YOUR_EXEC_URL_HERE/exec';
