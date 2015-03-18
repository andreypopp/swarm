"use strict";

var Spec = require('./Spec');
var IdArray = require('./IdArray');
var Syncable = require('./Syncable');
var ProxyListener = require('./ProxyListener');

/** Abstract base class for "smaller" collections.
    Backbone. 4000 full load */
var Collection = Syncable.extend('Collection', {

    defaults: {
        ids: IdArray,
        ins: IdArray,
        rms: IdArray, // TODO shared codebook
//        _proxy: ProxyListener, // underscoreds don't go to POJO (well...)
        _oplog: Object  // TODO move to Storage
    },

    ops: {
        in: function (spec, value, src) {
            var m = Collection.reTokExtSpKey.exec(value);
            var obj_id=m[1], key=m[4];
            var pos = this._findPosFor(spec, value, obj_id, key);
            this.ids.insert(obj_id, pos);
            this.ins.insert(spec.version(), pos);
            this.rms.insert("0", pos);
            if (this._keys) {
                this._keys.splice(pos,0,key);
            }
            this._rebuild(pos);
        },

        rm: function (spec, value, src) {
            var op_id = value; // TODO valid
            var pos = this.ins.find(op_id);
            this.rms.splice(pos,1,spec.version());
            this._rebuild(pos);
        }
    },

    reactions: {
        init: function (spec,val,src) {
            var self = this;
            self._rebuild();
            self._forEach(function (id) {
                self._object(id).on4(self._relay, self);
            }, this);
        },
        in: function (spec,value,src) {
            var m = Collection.reTokExtSpKey.exec(value);
            var obj_id=m[1];
            var obj = this._object(obj_id);
            obj.on4(this._relay, this);
            if (this._events) {
                this._events.queued.push({
                    name: "insert",
                    target: this,
                    value: obj.toPojo(),
                    entry_id: obj_id,
                    position: undefined // TODO
                });
            }
        },
        rm: function (spec,val,src) {
            var pos = this.ins.find(val);
            var i = this.ids.iterator(pos.pos);
            var obj = this._object(i.base64id());
            obj.off4(this._relay, this);
            if (this._events) {
                this._events.queued.push({
                    name: "remove",
                    target: this,
                    entry_id: obj._id,
                    position: undefined // TODO
                });
            }
        }
    },

    diff: function (base) {
        if (!base || base=='!0') { // == !
            return this.toPojo(true);
        } else {
            return Syncable._pt.diff.apply(this, arguments);
        }
    },

    _rebuild: function (pos) {
    },

    _findPosFor: function (spec, value) {
        return this.ids.length();
    },

    validate: function (spec, value) {
        if (spec.op()==="ins") {
            if (!Collection.reTokExtSpKey.test(value)) {
                return "invalid op value";
            }
        }
        return '';
    },

    _relay: function (ev) {
        var clone = {};
        for(var key in ev) {clone[key] = ev[key];}
        clone.entry = ev.target;
        clone.entry_id = ev.target._id;
        clone.target = this;
        clone.name = 'entry.' + ev.name;
        if (this._events) {
            this._events.queued.push(clone);
            this.emit4();
        }
    },

    _object: function (id) {
        if (!id) { return null; }
        var spec = '/'+this.entryType+'#'+id;
        var obj = this._host.get(spec);
        return obj;
    },

    _forEach: function (cb) { // TODO reimpl over view (has objs)
        var idi = this.ids.iterator();
        var rmi = this.rms.iterator();
        var ini = this.ins.iterator();
        while (idi.match) {
            var rm = rmi.id();
            if (rm==='0') {
                var id = idi.id();
                var op = ini.id();
                cb(id, op, rm);
            }
            idi.next();
            rmi.next();
            ini.next();
        }

    },

    gc: function () {

    },

    remove: function (op_id) {

    },

    _arg2id: function (obj, mayCreate) {
        if (!obj) {throw new Error("no null entries allowed (yet?)");}
        var spec;
        if (obj._id) {
            spec = obj.spec();
        } else if (Spec.is(obj)) {
            spec = new Spec(obj);
        } else if (obj.constructor===String && Spec.reTokExt.test(obj)) {
            return obj;
        } else if (mayCreate && obj.constructor===Object) { // new obj
            var o = new Syncable.types[this.entryType](obj);
            spec = o.spec();
        } else {
            throw new Error("not an object or a spec: "+obj);
        }
        if (spec.type()!==this.entryType) {
            throw new Error("only accept type "+this.entryType);
        }
        return spec.id();
    },

    insert: function (obj, location) {
        var obj_id = this._arg2id(obj, true);
        return this["in"](obj_id+' '+(location||''));
    }

});

Collection.rsTokExtSpKey = '^((=)(?:\\+(=))?)(?: (.*))$'.replace(/=/g, Spec.rT);
Collection.reTokExtSpKey = new RegExp(Collection.rsTokExtSpKey);
module.exports = Collection;


Collection.Vector = Collection.extend('Vector', {

    _findPosFor: function (spec, value, id, key) {
        var i, ins = this.ins;
        if (key==='0' || !key) {
            i = ins.iterator();
        } else {
            i = ins._find(ins.encoder.encode(key));
            if (i.match) { // FIXME correctness/order
                i.next();
            }
        }
        var op_ver = spec.version();
        while (i.match && ins.encoder.decode(i.enc4)>op_ver) {
            i.next();
        }
        return i.pos;
    },

    _rebuild: function (pos) {
        var self = this;
        self.vector = [];
        self._forEach(function (id){
            self.vector.push(self._object(id));
        });
        // TODO optimize
    },

    push: function (obj) {
        var last_in = '0';
        this._forEach(function(id,op,rm){ // FIXME :(
            last_in = op;
        });
        this["in"](this._arg2id(obj, true)+' '+last_in);
    },

    unshift: function (obj) {
        this["in"](this._arg2id(obj, true)+' 0');
    },

    pop: function () {
        var last_in = '0', last_id;
        this._forEach(function(id,op,rm){ // FIXME :(
            last_in = op;
            last_id = id;
        });
        this.rm(last_in);
        return this._object(last_id);
    },

    shift: function () {
        var last_in, last_id;
        this._forEach(function(id,op,rm){ // FIXME :(
            if (!last_in) {
                last_in = op;
                last_id = id;
            }
        });
        if (last_in) {
            this.rm(last_in);
        }
        return this._object(last_id);
    },

    toPojoCollection: function () {
        var self = this;
        var ret = [];
        self._forEach(function (id){
            ret.push(self._object(id).toPojo());
        });
        return ret;
    }

});