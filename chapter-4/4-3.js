const data = {
  txt: "hello world",
};

const bucket = new WeakMap();

let activeEffect;

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

  deps.forEach((fn) => fn());
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
  activeEffect = fn;
  fn();
}

effect(() => {
  console.log({ txt: obj.txt });
});

setTimeout(() => {
  obj.age = 18;
}, 100);

obj.txt = "hello vue3";

// const map = new Map();
// const weakMap = new WeakMap();

// (function () {
//   const foo = {
//     foo: 1,
//   };
//   const bar = {
//     bar: 2,
//   };
//   map.set(foo, 1);
//   weakMap.set(bar, 2);
// })();
