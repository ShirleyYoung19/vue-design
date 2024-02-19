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
    console.log("effectFn 执行了");
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

// const effectFn = effect(() => obj.foo + obj.bar, {
//   lazy: true,
// });

// console.log({ res: effectFn() });

const sumObj = computed(() => obj.foo + obj.bar);

console.log({ sum: sumObj.value });
console.log({ sum: sumObj.value });
console.log({ sum: sumObj.value });

obj.foo++;

console.log({ sum: sumObj.value });
console.log({ sum: sumObj.value });
console.log({ sum: sumObj.value });

effect(() => {
  console.log({ sum: sumObj.value });
});

obj.foo++;
