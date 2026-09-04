// MAX_SMS_RECIPIENTS: no cap on recipients per campaign (unlimited).
// Left as a named constant (rather than removing the checks) so a limit can be
// reintroduced later without re-touching every call site.
const MAX_SMS_RECIPIENTS = Infinity;
const MAX_SMS_SEGMENTS = 10;

module.exports = {
  MAX_SMS_RECIPIENTS,
  MAX_SMS_SEGMENTS
};