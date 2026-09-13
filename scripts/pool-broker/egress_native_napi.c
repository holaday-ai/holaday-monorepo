#include "egress_native.h"
#include <node_api.h>
#include <stdatomic.h>
#include <stdlib.h>

static atomic_int attempted = 0;
static const napi_type_tag tag = {0x9bcf6361bc78160dULL, 0x6b0292cd19428a54ULL};

static napi_value invalid(napi_env env) {
    napi_throw_error(env, "POOL_EGRESS_NATIVE_INVALID", "POOL_EGRESS_NATIVE_INVALID");
    return NULL;
}
static int no_arguments(napi_env env, napi_callback_info info, napi_value *self) {
    size_t argc = 1;
    napi_value argv[1];
    return napi_get_cb_info(env, info, &argc, argv, self, NULL) == napi_ok && argc == 0;
}
static struct hd_egress *original(napi_env env, napi_callback_info info) {
    napi_value self;
    bool matches = false;
    struct hd_egress *s = NULL;
    if (!no_arguments(env, info, &self) ||
        napi_check_object_type_tag(env, self, &tag, &matches) != napi_ok || !matches ||
        napi_unwrap(env, self, (void **)&s) != napi_ok) return NULL;
    return s;
}
static void finalize(napi_env env, void *data, void *hint) {
    (void)env; (void)hint;
    struct hd_egress *s = data;
    hd_egress_close(s); /* Transferred FD is no longer in this object. */
#ifdef HD_EGRESS_FINALIZER_OBSERVER
    /* Only the explicit Darwin fixture build defines this; no production API. */
    extern void hd_egress_test_finalized(int transferred);
    hd_egress_test_finalized(s->transferred);
#endif
    free(s);
}
static napi_value take(napi_env env, napi_callback_info info) {
    struct hd_egress *s = original(env, info);
    if (!s) return invalid(env);
    int fd = hd_egress_take(s);
    napi_value result;
    /* Even N-API allocation failure after take must NEVER close the old integer. */
    if (fd < 0 || napi_create_int32(env, fd, &result) != napi_ok) return invalid(env);
    return result;
}
static napi_value close_original(napi_env env, napi_callback_info info) {
    struct hd_egress *s = original(env, info);
    napi_value result;
    if (!s || hd_egress_close(s) != 0 || napi_get_undefined(env, &result) != napi_ok)
        return invalid(env);
    return result;
}
static napi_value create_listener(napi_env env, napi_callback_info info) {
    napi_value self, result;
    if (!no_arguments(env, info, &self) || atomic_exchange(&attempted, 1)) return invalid(env);
    struct hd_egress *s = calloc(1, sizeof(*s));
    if (!s) return invalid(env);
    hd_egress_init(s);
    if (napi_create_object(env, &result) != napi_ok ||
        napi_wrap(env, result, s, finalize, NULL, NULL) != napi_ok) {
        free(s);
        return invalid(env);
    }
    /* From here finalizer owns s, including every initialization error. */
    napi_property_descriptor methods[] = {
        {"take", NULL, take, NULL, NULL, NULL, napi_default, NULL},
        {"close", NULL, close_original, NULL, NULL, NULL, napi_default, NULL}
    };
    if (napi_type_tag_object(env, result, &tag) != napi_ok ||
        napi_define_properties(env, result, 2, methods) != napi_ok ||
        napi_object_freeze(env, result) != napi_ok || hd_egress_create(s) != 0) {
        hd_egress_close(s);
        return invalid(env);
    }
    return result;
}
NAPI_MODULE_INIT() {
    napi_property_descriptor api = {"createListener", NULL, create_listener,
        NULL, NULL, NULL, napi_default, NULL};
    if (napi_define_properties(env, exports, 1, &api) != napi_ok ||
        napi_object_freeze(env, exports) != napi_ok) return invalid(env);
    return exports;
}
