const data = {
  foo: 1,
  bar: 2,
};

const jobQueue = new Set();
const p = Promise.resolve();
let isFlushing = false;

function flushJob() {
  // 正在处理 job 就忽略不管了
  if (isFlushing) {
    return;
  }
  isFlushing = true;
  // 在微任务中执行
  p.then(() => {
    jobQueue.forEach((job) => {
      job();
    });
    jobQueue.clear();
  }).finally(() => {
    isFlushing = false;
  });
}

const bucket = new WeakMap();

let activeEffect;
const effectStacks = [];

const track = (target, prop) => {
  if (!activeEffect) return;

  let depsMap = bucket.get(target);

  if (!depsMap) {
    bucket.set(target, (depsMap = new Map()));
  }

  let depsSet = depsMap.get(prop);

  if (!depsSet) {
    depsMap.set(prop, (depsSet = new Set()));
  }

  depsSet.add(activeEffect);
  activeEffect.deps.push(depsSet);
};

const trigger = (target, prop) => {
  const depsMap = bucket.get(target);
  if (!depsMap) {
    return;
  }

  const deps = depsMap.get(prop);

  if (!deps) {
    return;
  }

  // Each value is visited once, except in the case when it was deleted and re-added before forEach() has finished.
  // forEach 过程中在 cleanup 中会将 effectFn 删除，然后又在 track 中将其加回去，
  // 所以这个地方要有一个新的值
  [...deps].forEach((fn) => {
    if (fn !== activeEffect) {
      if (fn.options.scheduler) {
        fn.options.scheduler(fn);
      } else {
        fn();
      }
    }
  });
};

const obj = new Proxy(data, {
  get(target, prop) {
    track(target, prop);

    return target[prop];
  },
  set(target, prop, value) {
    target[prop] = value;
    trigger(target, prop);
    return true;
  },
});

function effect(fn, options = {}) {
  function effectFn() {
    cleanup(effectFn);
    activeEffect = effectFn;
    effectStacks.push(effectFn);
    const res = fn();
    effectStacks.pop();
    activeEffect = effectStacks[effectStacks.length - 1];
    return res;
  }

  effectFn.deps = [];
  effectFn.options = options;

  // 新增
  if (options.lazy) {
    return effectFn;
  } else {
    effectFn();
  }
}

function cleanup(effectFn) {
  if (!effectFn.deps.length) {
    return;
  }

  effectFn.deps.forEach((depSet) => {
    depSet.delete(effectFn);
  });

  effectFn.deps.length = 0;
}

function computed(getter) {
  let cachedValue;
  let dirty = true;
  const effectFn = effect(getter, {
    lazy: true,
    scheduler: () => {
      if (!dirty) {
        dirty = true;
        // trigger(obj, "value");
      }
    },
  });

  const obj = {
    get value() {
      // track(obj, "value");
      if (dirty) {
        cachedValue = effectFn();
        dirty = false;
      }
      return cachedValue;
    },
  };

  return obj;
}

function traverse(value, seen = new Set()) {
  // 基础类型 + null
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return;
  }
  seen.add(value);
  for (const prop in value) {
    traverse(value[prop], seen);
  }
  return value;
}

/**
 *
 * @param {*} source
 * @param {*} callback
 * @param {*} options immediate: 回调函数是否是立即执行；
 *                    flush: 回调函数执行时机
 *                           pre dom 更新之前
 *                           sync 默认值，同步执行
 *                           post dom 更新之后的微任务队列里执行
 */
function watch(source, callback, options = {}) {
  let getter;

  if (typeof source === "function") {
    getter = source;
  } else {
    getter = () => {
      return traverse(source);
    };
  }

  let oldValue, newValue;

  const job = () => {
    newValue = effectFn();
    callback(newValue, oldValue);
    oldValue = newValue;
  };

  const effectFn = effect(getter, {
    scheduler: () => {
      if (options.flush === "post") {
        p.then(() => {
          job();
        });
      } else {
        job();
      }
    },
    lazy: true,
  });

  // 当 immediate 为 true 的时候，说明需要立刻执行一次回调，但是此时 oldValue 是 undefined
  if (options.immediate) {
    const p = Promise.resolve();
    job();
  } else {
    oldValue = effectFn();
  }
}

watch(
  () => obj.bar,
  (prev, next) => {
    console.log("变化了", prev, next);
  },
  {
    immediate: true,
    flush: "post",
  }
);

obj.foo++;
obj.bar++;
console.log("hi");
