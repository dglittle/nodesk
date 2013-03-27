
_.oDesk_getAll = function (o, path, params) {
    var kind = path.match(/([^\/]+)s(\?|$)/)[1]
    var kinds = kind + 's'
    if (!params) params = {}

    var accum = []
    var offset = 0
    var pageSize = 100
    while (true) {
        params.page = offset + ';' + pageSize
        var a = _.prom(o.get(path, params, _.prom()))[kinds]
        var b = a[kind]
        if (b) {
            if (b instanceof Array)
                accum.push(b)
            else
                accum.push([b])
        } else {
            break
        }
        offset += pageSize
        if (offset >= a.lister.total_count)
            break
    }
    return [].concat.apply([], accum)
}
