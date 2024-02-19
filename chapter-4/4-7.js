const data = {
  foo: 1,
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
        // 新增
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

function effect(fn, options) {
  function effectFn() {
    cleanup(effectFn);
    activeEffect = effectFn;
    effectStacks.push(effectFn);
    fn();
    effectStacks.pop();
    activeEffect = effectStacks[effectStacks.length - 1];
  }

  effectFn.deps = [];
  effectFn.options = options; // 新增
  effectFn();
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

effect(
  () => {
    console.log(obj.foo);
  },
  // 新增
  {
    scheduler: (effectFn) => {
      // setTimeout(() => {
      // effectFn();
      // }, 1000);

      jobQueue.add(effectFn);
      flushJob();
    },
  }
);

obj.foo++;
obj.foo++;

console.log("结束了");
