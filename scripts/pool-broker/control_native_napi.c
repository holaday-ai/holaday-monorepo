#include "control_native.h"
#include <node_api.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>

static atomic_uint attempts = 0;
static const napi_type_tag tag = {0xbbe795e4b074cf35ULL, 0xcaf9f5dc07e61025ULL};
static napi_value invalid(napi_env env) {
    napi_throw_error(env, "POOL_CONTROL_NATIVE_INVALID", "POOL_CONTROL_NATIVE_INVALID");
    return NULL;
}
static struct hd_control *original(napi_env env, napi_callback_info info, size_t expected, napi_value *arg) {
    napi_value self, values[2]; size_t count = 2; bool matches = false;
    struct hd_control *s = NULL;
    if (napi_get_cb_info(env, info, &count, values, &self, NULL) != napi_ok || count != expected ||
        napi_check_object_type_tag(env, self, &tag, &matches) != napi_ok || !matches ||
        napi_unwrap(env, self, (void **)&s) != napi_ok) return NULL;
    if (expected) *arg = values[0];
    return s;
}
static void finalize(napi_env env, void *data, void *hint) {
    (void)env; (void)hint;
    struct hd_control *s = data;
    hd_control_close(s);
    free(s);
}
static napi_value checked(napi_env env, napi_callback_info info) {
    struct hd_control *s = original(env, info, 0, NULL);
    napi_value result;
    if (!s || hd_control_check(s) || napi_get_undefined(env, &result) != napi_ok) return invalid(env);
    return result;
}
static napi_value ready(napi_env env, napi_callback_info info) {
    struct hd_control *s = original(env, info, 0, NULL);
    if (!s) return invalid(env);
    int status = hd_control_ready(s);
    napi_value result;
    if (status < 0 || napi_get_boolean(env, status == 1, &result) != napi_ok) {
        hd_control_close(s); return invalid(env);
    }
    return result;
}
static napi_value closed(napi_env env, napi_callback_info info) {
    struct hd_control *s = original(env, info, 0, NULL);
    napi_value result;
    if (!s || hd_control_close(s) || napi_get_undefined(env, &result) != napi_ok) return invalid(env);
    return result;
}
static napi_value ended(napi_env env, napi_callback_info info) {
    struct hd_control *s = original(env, info, 0, NULL);
    napi_value result;
    if (!s || hd_control_end(s) || napi_get_undefined(env, &result) != napi_ok) return invalid(env);
    return result;
}
static napi_value read_bytes(napi_env env, napi_callback_info info) {
    struct hd_control *s = original(env, info, 0, NULL);
    if (!s) return invalid(env);
    unsigned char bytes[4100] = {0};
    int n = hd_control_read(s, bytes);
    napi_value result;
    napi_status status = napi_generic_failure;
    if (n == -2) status = napi_get_undefined(env, &result);
    else if (n == 0) status = napi_get_null(env, &result);
    else if (n > 0) status = napi_create_buffer_copy(env, (size_t)n, bytes, NULL, &result);
    memset(bytes, 0, sizeof(bytes));
    if (status != napi_ok) { hd_control_close(s); return invalid(env); }
    return result;
}
static napi_value write_bytes(napi_env env, napi_callback_info info) {
    napi_value arg, result;
    struct hd_control *s = original(env, info, 1, &arg);
    bool is_buffer = false; void *data = NULL; size_t length = 0;
    if (!s) return invalid(env);
    if (napi_is_buffer(env, arg, &is_buffer) != napi_ok || !is_buffer ||
        napi_get_buffer_info(env, arg, &data, &length) != napi_ok || !length || length > 4100) {
        hd_control_close(s); return invalid(env);
    }
    unsigned char bytes[4100];
    memcpy(bytes, data, length); /* Native IO never borrows mutable JS storage. */
    int n = hd_control_write(s, bytes, length);
    memset(bytes, 0, sizeof(bytes));
    if (n < 0 || napi_create_int32(env, n, &result) != napi_ok) {
        hd_control_close(s); return invalid(env);
    }
    return result;
}
static napi_value connect_control(napi_env env, napi_callback_info info) {
    size_t count = 2; napi_value arg[2], result;
    int64_t deadline = 0;
    if (napi_get_cb_info(env, info, &count, arg, NULL, NULL) != napi_ok || count > 1)
        return invalid(env);
    if (count) {
        napi_valuetype type; bool lossless = false;
        long long now = hd_control_now();
        if (napi_typeof(env, arg[0], &type) != napi_ok || type != napi_bigint ||
            napi_get_value_bigint_int64(env, arg[0], &deadline, &lossless) != napi_ok ||
            !lossless || now < 0 || deadline <= now || deadline - now > 5000)
            return invalid(env);
    }
    if (
        /* One non-business boot handshake plus at most 32 business streams.
         * Root keeps its separate 32-create limit; this grants no extra slot. */
        atomic_fetch_add(&attempts, 1) >= 33) return invalid(env);
    struct hd_control *s = calloc(1, sizeof(*s));
    if (!s) return invalid(env);
    hd_control_init(s);
    /* Absolute and immutable: never restarted on ready/read/write or on connect.
     * Optional boot scope only shortens the existing native budgets. */
    s->scope_deadline = deadline;
    if (napi_create_object(env, &result) != napi_ok ||
        napi_wrap(env, result, s, finalize, NULL, NULL) != napi_ok) { free(s); return invalid(env); }
    napi_property_descriptor methods[] = {
        {"ready", NULL, ready, NULL, NULL, NULL, napi_default, NULL},
        {"check", NULL, checked, NULL, NULL, NULL, napi_default, NULL},
        {"read", NULL, read_bytes, NULL, NULL, NULL, napi_default, NULL},
        {"write", NULL, write_bytes, NULL, NULL, NULL, napi_default, NULL},
        {"end", NULL, ended, NULL, NULL, NULL, napi_default, NULL},
        {"close", NULL, closed, NULL, NULL, NULL, napi_default, NULL}
    };
    if (napi_type_tag_object(env, result, &tag) != napi_ok ||
        napi_define_properties(env, result, 6, methods) != napi_ok ||
        napi_object_freeze(env, result) != napi_ok || hd_control_open(s)) {
        hd_control_close(s); return invalid(env);
    }
    return result;
}
NAPI_MODULE_INIT() {
    napi_property_descriptor api = {"connectControl", NULL, connect_control, NULL, NULL, NULL, napi_default, NULL};
    if (napi_define_properties(env, exports, 1, &api) != napi_ok ||
        napi_object_freeze(env, exports) != napi_ok) return invalid(env);
    return exports;
}
