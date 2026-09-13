#include "control_native.h"
#include <string.h>

void hd_control_init(struct hd_control *s) {
    memset(s, 0, sizeof(*s));
    for (int i = 0; i < HC_FDS; ++i) s->fds[i] = -1;
}
int hd_control_close(struct hd_control *s) {
    s->retired = 1; /* Pure veto before the first close, including reentry. */
    for (int i = HC_FDS - 1; i >= 0; --i) {
        int fd = s->fds[i];
        s->fds[i] = -1;
        if (fd >= 0 && hd_control_close_fd(fd)) s->cleanup_failed = 1;
    }
    return s->cleanup_failed ? -1 : 0;
}
static int fail(struct hd_control *s) { hd_control_close(s); return -1; }
static int budget(struct hd_control *s) {
    long long now = hd_control_now();
    if (s->retired || now < s->last || now < s->started ||
        (s->scope_deadline && now >= s->scope_deadline) ||
        now - s->started >= (s->connected ? 60000 : 5000)) return -1;
    s->last = now;
    return 0;
}
int hd_control_check(struct hd_control *s) {
    return hd_control_ready(s) < 0 ? -1 : 0;
}
int hd_control_ready(struct hd_control *s) {
    if (!s->attempted || budget(s)) return fail(s);
    if (!s->connected) {
        int result = hd_control_connect(s);
        if (result < 0 || result > 1 || budget(s)) return fail(s);
        if (result == 1) return 0;
    }
    /* Pending, connection and the final observation share the original budget. */
    if (hd_control_observe(s) || budget(s)) return fail(s);
    s->connected = 1;
    return 1;
}
int hd_control_open(struct hd_control *s) {
    if (s->attempted || s->retired) return fail(s);
    s->attempted = 1;
    s->started = s->last = hd_control_now();
    if (s->started < 0) return fail(s);
    return hd_control_ready(s) < 0 ? -1 : 0;
}
int hd_control_read(struct hd_control *s, unsigned char out[4100]) {
    if (!s->connected || s->eof || hd_control_check(s)) return fail(s);
    int n = hd_control_recv(s, out);
    if (n < -2 || n == -1 || n > 4100 || hd_control_check(s)) {
        memset(out, 0, 4100);
        return fail(s);
    }
    if (n >= 0) {
        s->received += (size_t)n;
        if (s->received > 8200) { memset(out, 0, 4100); return fail(s); }
        if (!n) s->eof = 1;
    }
    return n;
}
int hd_control_write(struct hd_control *s, const unsigned char *bytes, size_t length) {
    if (!s->connected || !bytes || !length || length > 4100 || s->sent > 8200 || length > 8200 - s->sent ||
        s->write_ended || hd_control_check(s)) return fail(s);
    int n = hd_control_send(s, bytes, length);
    if (n < 0 || (size_t)n > length || hd_control_check(s)) return fail(s);
    s->sent += (size_t)n;
    if (s->sent > 8200) return fail(s);
    return n;
}
int hd_control_end(struct hd_control *s) {
    if (!s->connected || s->write_ended || hd_control_check(s)) return fail(s);
    s->write_ended = 1;
    if (hd_control_shutdown(s) || hd_control_check(s)) return fail(s);
    return 0;
}
