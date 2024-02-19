const data = {
  foo: true,
  bar: true,
};

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
  [...deps].forEach((fn) => fn());
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

function effect(fn) {
  function effectFn() {
    cleanup(effectFn);
    activeEffect = effectFn;
    effectStacks.push(effectFn);
    fn();
    effectStacks.pop();
    activeEffect = effectStacks[effectStacks.length - 1];
  }

  effectFn.deps = [];
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

effect(function effect1() {
  console.log("effect1 执行了");

  effect(function effect2() {
    console.log("effect2 执行了");
    console.log({ bar: obj.bar });
  });

  console.log({ foo: obj.foo });
});

obj.foo = false;
