/* Explicit syscall boundary. Not a fake public broker or ready response. */
#include "../control_native.h"
#include <assert.h>
#include <string.h>

static long long now;
static int failed_at, calls, closes[HC_FDS], close_failure, recv_count, send_count;
static int revoke_receive, receive_result, send_result, jump_connect, jump_observe;
static struct hd_control *original;
long long hd_control_now(void) { return now; }
int hd_control_close_fd(int fd) {
    assert(fd >= 10 && fd < 10 + HC_FDS);
    assert(original->retired);
    ++closes[fd - 10];
    return close_failure && fd == 12 ? -1 : 0;
}
int hd_control_connect(struct hd_control *s) {
    for (int i = 0; i < HC_FDS; ++i) {
        s->fds[i] = 10 + i; /* Ownership before post-acquisition failure. */
        if (++calls == failed_at) return -1;
    }
    now += jump_connect;
    return 0;
}
int hd_control_observe(struct hd_control *s) {
    (void)s;
    now += jump_observe;
    return ++calls == failed_at ? -1 : 0;
}
int hd_control_recv(struct hd_control *s, unsigned char out[4100]) {
    ++recv_count;
    memset(out, 0x73, 4100);
    if (revoke_receive) hd_control_close(s);
    return receive_result;
}
int hd_control_send(struct hd_control *s, const unsigned char *bytes, size_t length) {
    (void)s; (void)bytes; ++send_count;
    return send_result >= 0 ? send_result : (int)length;
}
int hd_control_shutdown(struct hd_control *s) { (void)s; return 0; }
static void setup(struct hd_control *s) {
    now = 100; failed_at = calls = close_failure = recv_count = send_count = 0;
    revoke_receive = jump_connect = jump_observe = 0;
    receive_result = 1; send_result = -1;
    memset(closes, 0, sizeof(closes)); original = s; hd_control_init(s);
}
static void all_closed(int count) {
    for (int i = 0; i < HC_FDS; ++i) assert(closes[i] == (i < count ? 1 : 0));
}
int main(void) {
    struct hd_control s;
    unsigned char bytes[4100];
    for (int step = 1; step <= HC_FDS + 1; ++step) {
        setup(&s); failed_at = step;
        assert(hd_control_open(&s) == -1);
        all_closed(step > HC_FDS ? HC_FDS : step);
        assert(hd_control_open(&s) == -1); assert(hd_control_close(&s) == 0);
        all_closed(step > HC_FDS ? HC_FDS : step);
    }
    setup(&s); assert(hd_control_open(&s) == 0);
    receive_result = -2; assert(hd_control_read(&s, bytes) == -2);
    receive_result = 4100;
    assert(hd_control_read(&s, bytes) == 4100); assert(hd_control_read(&s, bytes) == 4100);
    assert(hd_control_read(&s, bytes) == -1); assert(bytes[0] == 0); all_closed(HC_FDS);
    setup(&s); assert(hd_control_open(&s) == 0); revoke_receive = 1;
    assert(hd_control_read(&s, bytes) == -1); assert(bytes[0] == 0); all_closed(HC_FDS);
    setup(&s); assert(hd_control_open(&s) == 0); receive_result = 0;
    assert(hd_control_read(&s, bytes) == 0); assert(hd_control_read(&s, bytes) == -1);
    assert(recv_count == 1); all_closed(HC_FDS);
    setup(&s); jump_connect = 5000; assert(hd_control_open(&s) == -1); all_closed(HC_FDS);
    setup(&s); jump_connect = 4900; jump_observe = 200;
    assert(hd_control_open(&s) == -1); all_closed(HC_FDS);
    setup(&s); assert(hd_control_open(&s) == 0); jump_observe = 60000;
    assert(hd_control_write(&s, bytes, 1) == -1); assert(send_count == 0); all_closed(HC_FDS);
    setup(&s); assert(hd_control_open(&s) == 0); now = 99;
    assert(hd_control_read(&s, bytes) == -1); assert(recv_count == 0); all_closed(HC_FDS);
    setup(&s); assert(hd_control_open(&s) == 0); send_result = 0;
    assert(hd_control_write(&s, bytes, 1) == 0); send_result = 1;
    assert(hd_control_write(&s, bytes, 2) == 1); assert(s.sent == 1);
    assert(hd_control_end(&s) == 0); assert(hd_control_write(&s, bytes, 1) == -1); all_closed(HC_FDS);
    setup(&s); assert(hd_control_open(&s) == 0);
    assert(hd_control_write(&s, bytes, 4100) == 4100);
    assert(hd_control_write(&s, bytes, 4100) == 4100);
    assert(hd_control_write(&s, bytes, 1) == -1); assert(send_count == 2); all_closed(HC_FDS);
    setup(&s); assert(hd_control_open(&s) == 0); close_failure = 1;
    assert(hd_control_close(&s) == -1); assert(hd_control_close(&s) == -1); all_closed(HC_FDS);
    return 0;
}
