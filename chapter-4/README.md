# 4.1 响应式数据与副作用函数

副作用函数是指会产生副作用的函数，比如

```javascript
function effect() {
  document.body.innerText = "hello world";
}
```

当 effect 函数执行的时候，会设置 body 的文本内容，其它的函数也可以读取或者设置 body 的文本内容，也就是说 effect 函数的执行会直接或者间接影响其它函数的执行，这种情况下就可以说 effect 函数产生了副作用。

那么什么是响应式数据呢？

```javascript
const obj = {
  txt: "hello",
};

function effect() {
  document.body.innerText = obj.txt;
}
```

上面这一段代码中，我们将 body 的文本设置为对象 obj 的 txt 属性。假如 effect 被调用后，后面紧接着有这样一段代码

```javascript
obj.txt = "hello world";
```

修改了 obj.txt 的值。假如这个时候 effect 函数能够自动重新执行，这样对象 obj 就是一个响应式数据。

# 4.2 响应式数据的基本实现

如何实现一个响应式数据呢？

从上面一章中，我们可以了解到，

- effect 函数在执行时，对 obj.txt 进行了读操作
- 重新赋值时，对 obj.txt 进行了写操作

那么由此，实现思路就可以变成

- 创建一个桶来存储数据
- 读取属性时，往桶里存入副作用函数
- 属性赋值时，从桶里取出副作用函数来执行

流程图如下：

![get property](https://res.weread.qq.com/wrepub/CB_3300028078_image00498.jpeg)
![set property](https://res.weread.qq.com/wrepub/CB_3300028078_image00499.jpeg)

实现方式，利用 proxy，在读取属性时将 effect 函数存入桶中；在设置属性时，从桶中拿出所有 effect 函数进行执行。

```javascript
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
```

但是上面的代码只能实现基础的功能，有一些硬编码的存在，比如 effect 函数名。后续需要进一步优化

# 4.2 设计一个完善的响应系统

首先要解决的第一个问题是 effect 函数的搜集，显然之前直接硬编码为 effect 这一函数名称是不合适的。

```javascript
let activeEffect;

function effect(fn) {
  activeEffect = fn;
  fn();
}
```

实现方式是定义一个 activeEffect 变量，用于存储当前的副作用函数；再定义一个 effect 函数，专门用于生成副作用函数的函数，这样不管 fn 如果定义，在 Proxy 的 get 方法搜集时，都可以用 activeEffect 作为被搜集的副作用函数的名称。

解决了 effect 硬编码问题之后，我们这个设计还有一个需要解决的问题，假如在重新赋值的操作之后，又对另外一个属性进行了赋值，目前的实现会导致 effect 再次执行。因为我们存储时并没有明确这是哪个对象哪个属性的副作用函数。为了解决这个问题，我们需要重新设计桶的数据结构。

观察 effect 函数

```javascript
effect(function effectFn() {
  console.log(obj.txt);
});
```

涉及到内容有

- 代理后的的对象 obj
- 需要监听的对象属性 key
- 需要存储的副作用函数 effectFn

因此数据结构设计为：
bucket 为 weakMap： 属性为 target 对象，值为 map (因为属性会是对象，为了方便垃圾回收，使用 weakMap 而不是 map)
map 的属性为 prop，值为 set
set 中存储的是 effectFn 等副作用函数合集

具体如下图

![bucket data](https://res.weread.qq.com/wrepub/CB_3300028078_image00500.jpeg)

代码实现如下：

```javascript
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
```

从这段代码可以看出构建数据结构的方式，我们分别使用了 WeakMap、Map 和 Set：

- WeakMap 由 target --> Map 构成；
- Map 由 key --> Set 构成。
  其中 WeakMap 的键是原始对象 target，WeakMap 的值是一个 Map 实例，而 Map 的键是原始对象 target 的 key，Map 的值是一个由副作用函数组成的 Set。

为了方便描述，我们把 Set 数据结构所存储的副作用函数集合称为 key 的依赖集合。

# 4.4 分支切换和 clean up

假如我们的 effectFn 是这样的：

```javascript
   effect(function effectFn(() => {
    console.log({txt: obj.ok ? obj.txt : 'not'})
   }))
```

那么当 obj.ok 变成 false 之后，预期是 obj.txt 的变化是不会导致副作用函数再重新执行一遍了，但是目前的实现是会再执行一遍的，因此我们需要添加上清理的工作。

再仔细分析一下：

函数 1 使用了 ok 和 txt，
函数 2 使用了 ok
函数 3 使用 txt

那么对应的依赖合集是

ok: [fn1, fn2]
txt: [fn1, fn3]

当 ok 变化的时候，我们希望 ok: [], 同时把 txt 为 [fn3], 然后触发一次 fn1 的执行，由这一次的 fn1 的执行决定后续 ok 和 txt 的值。fn2 同理。

所以目标是一个属性值的变化，触发依赖合集中的副作用函数执行，首先把本身和其他属性的依赖合集中存储的这个副作用函数删掉，然后再真正的执行函数内容。

所以需要一个反向的存储，通过 effectFn 能够拿到所有存储这个 effectFn 的依赖合集。

因此改造一下 effect 函数，在其内部设定一个 effectFn, 并绑定一个属性 effectFn.deps = []，在副作用函数执行时，先将 effectFn.deps 里面的依赖集合里面的 effectFn 移除。

那什么时候往 effectFn.deps 内添加呢？可以放在 track 函数里面，在往依赖集合里面添加 effectFn 时，反向将依赖合集添加的 effectFn.deps 里面。

具体改动如下：

```javascript
function effect(fn) {
  function effectFn() {
    cleanup(effectFn);
    activeEffect = effectFn;
    fn();
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

const track = (target, prop) => {
  // ...
  activeEffect.deps.push(depsSet);
};
```

需要有一个注意的点，Set 的 forEach 方法中，如果先删除一个元素，再增加一个元素，那么会导致 forEach 永远结束不了。之前的代码实现中，trigger 中会调用依赖合集的 forEach 方法，调用对应的 effectFn, 在 effectFn 中的 cleanup 方法中，会将依赖合集里面的 effectFn 删除，紧接着又在 fn 执行时，再在依赖合集中增加一个元素，会导致无限循环，因此需要在 trigger 中 创建一个新的 Set 或者数组来做轮询。

# 4.5 嵌套的 effect 和 effect 栈

嵌套的 effect 是指 effect 内又调用了 effect 比如：

```javascript
effect(function effect1() {
  // ...
  effect(function effect2() {
    // ...
  });
});
```

显然这种情况下，假如 effect2 中使用的对象属性变化后，应该是 effect1 不执行的；effect1 中使用的对象属性变化后，应该是 effect1 执行，effect2 间接也会执行。

但是之前的代码设计，activeEffect 在嵌套的情况下，会先等于 effect1, 在 effect1 执行时，会走到 effect2 的逻辑内，activeEffect 会重新指向 effect2，但是 effect2 执行完成之后，没有一个回退的逻辑。导致 effect1 的引用对象上的依赖合集其实也是塞入的 effect2。

为了解决这个问题，我们创建一个 effectStack, 先进后出，在 effect 函数中，fn 执行之前将 effectFn 塞入 effectStack， fn 执行之后，将 effectFn 最后一个元素弹出，同时将 activeEffect 指向 effectStack 的最后一个元素。

```javascript
function effect(fn) {
  function effectFn() {
    cleanup(effectFn);
    activeEffect = effectFn;
    effectStacks.push(effectFn); // 新增
    fn();
    effectStacks.pop(); // 新增
    activeEffect = effectStacks[effectStacks.length - 1]; // 新增
  }

  effectFn.deps = [];
  effectFn();
}
```

# 4.6 避免无限递归循环

假如 effectFn 是一个即包含读又包含写的操作，比如：

```javascript
effect(() => {
  obj.foo++;
});
```

按照现有代码逻辑，effect 函数执行时，走到 fn() 时会先读取 obj.foo 的值，此时这个副作用函数被收录到了桶里，紧接着对 obj.foo 进行赋值，那么就会触发 trigger, trigger 中又会从依赖集合中拿出来 effectFn 进行执行，进而又触发了 fn 的执行。相当于在 fn 中又调用了 fn，然后又调用了 fn，从而导致函数会一直执行。

经过分析，我们可以发现 track 搜集的副作用函数和 trigger 中触发执行的副作用函数都是 activeEffect。那么解法就是在 trigger 中拿到 effectFn 的时候与 activeEffect 对比一下，当两者不同的时候再执行 effectFn， 从而避免无限递归。

```javascript
const trigger = (target, prop) => {
  // ...
  [...deps].forEach((fn) => {
    if (fn !== activeEffect) {
      // 新增
      fn();
    }
  });
};
```

# 4.7 可调度性

响应式系统中可调度性是非常重要的特性。所谓可调度性是指当 trigger 动作触发副作用函数执行时，有能力控制副作用函数执行的时机、次数以及方式。

先看一下如果调用副作用函数的执行方式，比如有下面的代码：

```javascript
effect(() => {
  console.log(obj.foo);
});

obj.foo++;

console.log("结束了");
```

按照目前的代码，输出为 1， 2， 结束了
如果想要输出 1， 结束了，2
除了调整代码的顺序，还有没有更优雅的解决方案？

我们可以在 effect 函数中传入第二个参数 options.在 options 中定义一个 scheduler 函数，并将 options 函数挂载到 effectFn 上。
在 trigger 中触发副作用函数执行时，判断一下 options.scheduler 是否存在，如果存在的话就将 effectFn 传入 scheduler 函数，由调用方决定如何执行。

```javascript
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
```

在比如说执行次数的控制，上面的例子假如 obj.foo++ 被连续调用两次，那么 effectFn 应该也会再连续执行两次，从 1 => 2 => 3。但是很多情况下我们是不希望它会被执行这么多次的，比如 ui 刷新，肯定是希望尽量避免 rerender。借助调度器，我们就可以实现了

```javascript
const jobQueue = new Set();
const p = Promise.resolve();
let isFlushing = false;

function flushJob() {
  // 正在处理就不管了
  if (isFlushing) {
    return;
  }
  isFlushing = true;

  p.then(() => {
    jobQueue.forEach((job) => job());
    jobQueue.clear();
  }).finally((isFlushing = false));
}

schedular(effectFn) {
  jobQueue.add(effectFn);
  flushJob();
}
```

# 4.8 计算属性 computed 与 lazy

目前副作用函数时立即执行的，但是有时我们是不希望副作用函数立即执行，希望能在我们指定的时机再执行。针对这种情况，可以在 options 增加一个 lazy 字段，当 lazy 字段存在的时候，不执行 effectFn，而是将 effectFn 函数返回

```javascript
function effect(fn, options) {
  function effectFn() {
    cleanup(effectFn);
    activeEffect = effectFn;
    effectStacks.push(effectFn);
    const res = fn(); // 新增
    effectStacks.pop();
    activeEffect = effectStacks[effectStacks.length - 1];
    return res; // 新增
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
```

在 effect 函数内部定义 effectFn 也要配合改造，因为自行调用的时候，可能会需要 fn 函数的返回值。

那如何实现 computed 呢？

```javascript
function computed(getter) {
  const effectFn = effect(getter, {
    lazy: true,
  });

  const obj = {
    // 将 obj 的 value 属性设置为 getter, 每次获取值的时候就使用副作用函数 effectFn
    get value() {
      return effectFn();
    },
  };

  return obj;
}

const sumObj = computed(() => obj.foo + obj.bar);
console.log({ sum: sumObj.value });
```

这样的话，每次调用 sumObj.value 的时候 computed 内部的 effectFn 都会重新执行一遍，即使 obj.foo 和 obj.bar 的值都没有发生变化。进一步优化可以加一层缓存

```javascript
function computed(getter) {
  let cachedValue;
  // 是否过期
  let dirty = true;
  const effectFn = effect(getter, {
    lazy: true,
    // 依赖的数值变化之后会触发 scheduler，但是不要再触发effectFn了，让外部决定什么时候触发。只是将 dirty 重置成 true
    scheduler: () => {
      if (!dirty) {
        dirty = true;
      }
    },
  });

  const obj = {
    // 将 obj 的 value 属性设置为 getter, 每次获取值的时候就使用副作用函数 effectFn
    get value() {
      if (dirty) {
        cachedValue = effectFn();
        dirty = false;
      }
      return cachedValue;
    },
  };

  return obj;
}

const sumObj = computed(() => obj.foo + obj.bar);
console.log({ sum: sumObj.value });
```

但是这里还有一个问题，假如 sumObj 在另外一个副作用函数中被使用了呢？

```javascript
effect(() => {
  console.log({ sum: sumObj.value });
});
```

此时发现 obj.foo 变更时，上述 effectFn 不会自动重新执行。
原因是上述副作用函数的 fn 执行的时候，跟 obj 没有关系，不会将这个副作用函数搜集到 obj 下面属性的依赖合集中去。

解决方法是手动完成依赖搜集和依赖执行的过程。思路如下：
当上述副作用函数执行到 fn 的时候，在 value 的 getter 函数中手动触发 track

sumObj -> value -> [() => { console.log({ sum: sumObj.value })}]

而当 obj.foo 发生变化的时候，会触发 computed 内定义的 effectFn 的重新执行，即 schedular 函数执行，此时手动调用 sumObj -> value 的 trigger, 从而 () => { console.log({ sum: sumObj.value })} 函数会再调用一次，并且能拿到最新的 sumObj.value。
从而完成 obj.foo 的变化能触发包含 sumObj 的副作用函数重新执行。

![computed](https://res.weread.qq.com/wrepub/CB_3300028078_image00507.jpeg)

```javascript
function computed(getter) {
  let cachedValue;
  // 是否过期
  let dirty = true;
  const effectFn = effect(getter, {
    lazy: true,
    // 依赖的数值变化之后会触发 scheduler，但是不要再触发effectFn了，让外部决定什么时候触发。只是将 dirty 重置成 true
    scheduler: () => {
      if (!dirty) {
        dirty = true;
        trigger(obj, "value");
      }
    },
  });

  const obj = {
    // 将 obj 的 value 属性设置为 getter, 每次获取值的时候就使用副作用函数 effectFn
    get value() {
      if (dirty) {
        cachedValue = effectFn();
        dirty = false;
        track(obj, "value");
      }
      return cachedValue;
    },
  };

  return obj;
}

const sumObj = computed(() => obj.foo + obj.bar);
console.log({ sum: sumObj.value });
```

# 4.9 watch 的实现

watch 的第一个参数可以是具体的值，也可以是一个 getter。
当对应的 obj 的值变化的时候，第二个参数回调函数会自动被处罚执行，并且能够拿到最新的值和之前的值。

```javascript
watch(
  () => obj.foo, // obj
  (newValue, oldValue) => {
    console.log(newValue, oldValue);
  }
);
```

当第一个参数是 getter 的时候是好处理的，但是假如第一个参数是 obj 对象的时候，需要一个机制能够访问到 obj 中的所有属性。定义 traverse 函数：

```javascript
function traverse(obj, seen = new Set()) {
  if (typeof obj !== "object" || obj === null || seen.has(obj)) {
    return;
  }
  seen.add(obj);

  for (const k in obj) {
    traverse(k, seen);
  }

  return obj;
}
```

而新旧值，可以采用 lazy 来处理。 通过设置 lazy 为 true，记录下第一次执行的值为 oldValue，然后在 schedular 被触发的时候的得到的值为新值。

```javascript
function watch(source, cb) {
  let getter;
  if (typeof source === "function") {
    getter = source;
  } else {
    getter = () => traverse(source);
  }

  let oldValue, newValue;

  const effectFn = effect(() => getter(), {
    lazy: true,
    schedular: () => {
      newValue = effectFn();
      cb(newValue, oldValue);
      oldValue = newValue;
    },
  });

  oldValue = effectFn();
}
```

# 4.10 立即执行的 watch 和回调执行的时机

在上一节中我们了解到 watch 就是对 effect 的封装。当响应式的数据变化的时候会触发回调。但是有的时候需要回调函数立即执行一次，此时可以在 watch 的入参中增加第三个参数来实现

```javascript
function watch(source, cb) {
  let getter;
  if (typeof source === "function") {
    getter = source;
  } else {
    getter = () => traverse(source);
  }

  let oldValue, newValue;

  const job = () => {
    newValue = effectFn();
    cb(newValue, oldValue);
    oldValue = newValue;
  };

  const effectFn = effect(() => getter(), {
    lazy: true,
    scheduler: () => {
      job();
    },
  });

  if (options.immediate) {
    job();
  } else {
    oldValue = effectFn();
  }
}
```

将 scheduler 中的函数提出来，如果需要回调函数立即执行，其实与响应式数据变更之后的执行是一样的，只是立即执行的时候 oldValue 为空。
因此增加 options.immediate 判断，如果为 true，那么就立即执行一次；否则的话就给 oldValue 赋值。

此外在 Vue 中还有一个 flush 选项，这个选项的值可以是 'pre' | 'sync' | 'post'。分别代表在 dom 更新前、dom 更新时、dom 更新之后执行回调函数。
之前默认处理就是同步的，在 dom 更新时调用回调函数。
而 post 的处理与之前 flushJob 思路相同，将回调函数放到一个微任务中，保证其在 dom 更新之后执行。
而 pre 目前暂时还不能模拟。

```javascript
function watch(source, cb) {
  let getter;
  if (typeof source === "function") {
    getter = source;
  } else {
    getter = () => traverse(source);
  }

  let oldValue, newValue;

  const job = () => {
    newValue = effectFn();
    cb(newValue, oldValue);
    oldValue = newValue;
  };

  const effectFn = effect(() => getter(), {
    lazy: true,
    scheduler: () => {
      if (options.flush === "post") {
        const p = Promise.resolve();
        p.then(() => {
          job();
        });
      } else {
        job();
      }
    },
  });

  if (options.immediate) {
    job();
  } else {
    oldValue = effectFn();
  }
}
```

# 4.11 过期的副作用

watch 的回调可能会存在竞态问题。比如下面这种情况

```javascript
let finalObj;
watch(obj, async () => {
  const result = await fetch("/fetch/something");
  finalObj = result;
});
```

假如前后发起两个请求 A 和 B。 A 的结果比 B 的结果后返回，那么 finalObj 中其实是 resultA, 但是我们预期的是 resultB。
在 Vue 中解决这个问题的方法是传入第三个参数 onInvalidate。例如

```javascript
let finalObj;

watch(obj, async (next, prev, onInvalidate) => {
  let expired = false;
  onInvalidate(() => {
    expired = true;
  });
  const result = await fetch("/fetch/something");
  if (!expired) {
    finalObj = result;
  }
});
```

回调函数内传入第三个参数，当回调函数中定义一个 expired 变量，当回调函数失效的时候，也就是有新的回调函数执行的时候，将 expired 设置为 true。这样的话，等请求的结果返回的时候，如果 expired 为 true 了，就不进行后面的赋值操作。

因此需要对 watch 函数进行改造

```javascript
function watch(source, cb) {
  let getter;
  if (typeof source === "function") {
    getter = source;
  } else {
    getter = () => traverse(source);
  }

  let oldValue, newValue;

  let cleanUp;

  const onInvalidate = (invalidateCb) => {
    cleanUp = invalidateCb;
  };

  const job = () => {
    if (cleanUp) {
      cleanUp();
    }
    newValue = effectFn();
    cb(newValue, oldValue, invalidateCb);
    oldValue = newValue;
  };

  const effectFn = effect(() => getter(), {
    lazy: true,
    scheduler: () => {
      if (options.flush === "post") {
        const p = Promise.resolve();
        p.then(() => {
          job();
        });
      } else {
        job();
      }
    },
  });

  if (options.immediate) {
    job();
  } else {
    oldValue = effectFn();
  }
}
```

在 watch 函数内部设置一个 cleanUp 变量。然后定义 onInvalidate 函数为将传入的失效时执行的函数赋值给 cleanUp。在 job 调用的时候，先判断是不是有 cleanUp, 如果有的话就先执行 cleanUp。
![race](https://res.weread.qq.com/wrepub/CB_3300028078_image00509.jpeg)
