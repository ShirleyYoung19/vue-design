const data = {
  txt: "hello world",
};

const bucket = new Set();

const obj = new Proxy(data, {
  get(target, prop) {
    bucket.add(effect);
    return target[prop];
  },
  set(target, prop, value) {
    target[prop] = value;
    bucket.forEach((fn) => fn());
    return true;
  },
});

function effect() {
  console.log({ txt: obj.txt });
}

effect();
obj.txt = "hello vue3";
