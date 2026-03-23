# TypeScript 面试题

> 覆盖类型系统、泛型、类型体操、工程配置的高频 TypeScript 面试题。

## 相关链接

- 对应技术资料：[TypeScript高级编程](../../01-技术资料/01-前端/05-TypeScript高级编程.md)

## 🔥 高频考点速记

| #   | 考点                    | 核心要点（一句话）                                 | 出题概率 |
| --- | ----------------------- | -------------------------------------------------- | -------- |
| 1   | interface vs type       | interface可声明合并+extends，type支持联合交叉+映射 | ★★★★★    |
| 2   | 泛型                    | 类型参数化，约束extends+推断infer                  | ★★★★★    |
| 3   | 类型收窄                | typeof/instanceof/in/判别联合，控制流分析          | ★★★★★    |
| 4   | 工具类型实现            | Partial/Pick/Omit/ReturnType 手写源码              | ★★★★★    |
| 5   | any vs unknown vs never | any无检查，unknown需收窄，never=空集               | ★★★★☆    |
| 6   | 条件类型                | T extends U ? X : Y，联合分布特性                  | ★★★★☆    |
| 7   | 协变与逆变              | 函数参数逆变(-in)，返回值协变(+out)                | ★★★★☆    |
| 8   | 声明文件                | .d.ts/declare module/三斜杠/DefinitelyTyped        | ★★★☆☆    |
| 9   | tsconfig strict         | strictNullChecks/strictFunctionTypes/noImplicitAny | ★★★☆☆    |
| 10  | TypeScript 5.x          | satisfies/const type params/decorators/using       | ★★★☆☆    |

## 目录

- [⭐ 基础题 (Q1-Q10)](#-基础题-q1-q10)
- [⭐⭐ 进阶题 (Q11-Q18)](#-进阶题-q11-q18)
- [⭐⭐⭐ 高级题 (Q19-Q25)](#-高级题-q19-q25)

---

## ⭐ 基础题 (Q1-Q10)

### Q1. interface 和 type 有什么区别？什么时候用哪个？

**面试官意图**：考察对 TypeScript 两种类型定义方式的理解深度，以及在实际项目中的选型能力。

**思路分析**：从语法能力差异、扩展性、性能三个维度展开对比。

**参考答案**：

`interface` 和 `type` 都可以定义对象类型，但有以下核心差异：

**1. 声明合并（Declaration Merging）**

```typescript
// interface 支持声明合并 — 同名自动合并
interface User {
  name: string;
}
interface User {
  age: number;
}
// 等价于 interface User { name: string; age: number }

// type 不支持 — 同名会报错
type User = { name: string };
type User = { age: number }; // ❌ Error: Duplicate identifier 'User'
```

**2. 扩展方式**

```typescript
// interface 用 extends
interface Animal {
  name: string;
}
interface Dog extends Animal {
  bark(): void;
}

// type 用 & 交叉类型
type Animal = { name: string };
type Dog = Animal & { bark(): void };
```

**3. type 独占的能力**

```typescript
// 联合类型
type ID = string | number;

// 映射类型
type Optional<T> = { [K in keyof T]?: T[K] };

// 条件类型
type IsString<T> = T extends string ? true : false;

// 元组
type Pair = [string, number];
```

**4. 编译器性能**

`interface` 有命名缓存机制，在复杂类型运算中性能略优于 `type`。TypeScript 官方推荐：能用 `interface` 的场景优先使用 `interface`。

**选型建议**：

- 对象形状定义、类的契约 → `interface`
- 联合类型、交叉类型、工具类型 → `type`
- 扩展第三方库类型（利用声明合并）→ `interface`

---

### Q2. any、unknown、never 的区别？各自使用场景

**面试官意图**：考察对 TypeScript 类型层级的理解，以及在安全编码中的选型能力。

**思路分析**：从类型层级（顶部类型 vs 底部类型）和类型安全性两个角度切入。

**参考答案**：

```diagram
          any（不在正常层级中，绕过类型检查）

         unknown（最顶部类型，接受一切赋值）
        ┌───┼───┐
     string number boolean ... （具体类型）
        └───┼───┘
         never（最底部类型，空集）
```

| 特性             | `any`   | `unknown` | `never`           |
| ---------------- | ------- | --------- | ----------------- |
| 赋值给其他类型   | ✅ 任意 | ❌ 需收窄 | ✅ 任意（子类型） |
| 其他类型赋值给它 | ✅ 任意 | ✅ 任意   | ❌ 不可能         |
| 可做任意操作     | ✅      | ❌        | ❌                |
| 类型安全         | ❌      | ✅        | ✅                |

```typescript
// any — 关闭类型检查
let a: any = 42;
a.nonexistent.method(); // 不报错，但运行时崩溃

// unknown — 安全的顶部类型，使用前必须收窄
let u: unknown = 42;
// u.toFixed()  // ❌ 不能直接操作
if (typeof u === "number") {
  u.toFixed(); // ✅ 收窄后可以
}

// never — 不可能存在的类型
function throwError(msg: string): never {
  throw new Error(msg); // 永远不会返回
}

// never 在穷举检查中的妙用
type Shape = "circle" | "square";
function area(shape: Shape) {
  switch (shape) {
    case "circle":
      return 3.14 * 100;
    case "square":
      return 100;
    default:
      const _: never = shape; // 如果新增了类型但没加 case，这里报错
      return _;
  }
}
```

**使用场景**：

- `any`：仅用于 JS 迁移过渡期，新代码禁止使用
- `unknown`：替代 `any` 用于接受未知数据（如 API 响应、JSON.parse）
- `never`：函数永不返回、穷举检查、类型运算中的空集

---

### Q3. 什么是类型收窄？有哪些方式？

**面试官意图**：考察对 TypeScript 控制流分析（CFA）的理解。

**思路分析**：列举 4-5 种收窄方式，每种给出代码示例。

**参考答案**：

类型收窄（Narrowing）是 TypeScript 通过控制流分析，在特定代码路径中将宽泛类型缩小为更具体类型的能力。

**方式一：typeof 守卫**

```typescript
function format(value: string | number) {
  if (typeof value === "string") {
    return value.toUpperCase(); // string
  }
  return value.toFixed(2); // number
}
```

**方式二：instanceof 守卫**

```typescript
function logError(err: Error | string) {
  if (err instanceof Error) {
    console.log(err.stack); // Error
  } else {
    console.log(err); // string
  }
}
```

**方式三：in 操作符**

```typescript
interface Bird {
  fly(): void;
}
interface Fish {
  swim(): void;
}

function move(animal: Bird | Fish) {
  if ("fly" in animal) {
    animal.fly(); // Bird
  } else {
    animal.swim(); // Fish
  }
}
```

**方式四：判别联合（Discriminated Unions）**

```typescript
type Result<T> = { ok: true; value: T } | { ok: false; error: Error };

function unwrap<T>(result: Result<T>): T {
  if (result.ok) {
    return result.value; // TS 知道是 { ok: true; value: T }
  }
  throw result.error; // TS 知道是 { ok: false; error: Error }
}
```

**方式五：自定义类型守卫（Type Predicate）**

```typescript
function isNonNull<T>(value: T | null | undefined): value is T {
  return value != null;
}

const items = [1, null, 2, undefined, 3];
const nonNullItems = items.filter(isNonNull); // number[]
```

---

### Q4. 枚举 enum 和 const enum 区别？

**面试官意图**：考察对枚举编译产物和运行时行为的理解。

**思路分析**：对比编译产物、运行时开销、使用限制。

**参考答案**：

```typescript
// 普通 enum — 编译为 IIFE 对象
enum Color {
  Red,
  Green,
  Blue,
}
// 编译结果：
// var Color;
// (function (Color) {
//   Color[Color["Red"] = 0] = "Red";
//   Color[Color["Green"] = 1] = "Green";
//   Color[Color["Blue"] = 2] = "Blue";
// })(Color || (Color = {}));

// const enum — 编译时完全内联
const enum Color2 {
  Red,
  Green,
  Blue,
}
const c = Color2.Red;
// 编译结果：const c = 0  （Color2 完全消失）
```

| 对比       | `enum`                  | `const enum`               |
| ---------- | ----------------------- | -------------------------- |
| 运行时产物 | 有（JS 对象）           | 无（内联替换）             |
| 反向映射   | ✅ `Color[0] === 'Red'` | ❌ 不支持                  |
| 动态访问   | ✅ `Color[variable]`    | ❌ 不支持                  |
| 树摇友好   | ❌                      | ✅                         |
| 跨文件使用 | ✅                      | ⚠️ 需 `preserveConstEnums` |

**最佳实践**：现代项目推荐用 `as const` 对象替代枚举：

```typescript
const Status = { Active: "active", Inactive: "inactive" } as const;
type Status = (typeof Status)[keyof typeof Status]; // 'active' | 'inactive'
```

---

### Q5. 泛型是什么？如何给泛型添加约束？

**面试官意图**：考察对泛型基础概念和约束的掌握。

**思路分析**：用类比解释泛型概念，然后展示约束语法。

**参考答案**：

泛型是类型的"参数化"——让函数、接口、类可以处理多种类型，同时保持类型安全。

> **类比**：泛型就像饮料机的"杯型选择"按钮——机器逻辑（代码）一样，但可以选择大杯/中杯/小杯（不同类型），而不是为每种杯型造一台机器。

```typescript
// 泛型函数
function first<T>(arr: T[]): T | undefined {
  return arr[0];
}
first([1, 2, 3]); // number | undefined
first(["a", "b"]); // string | undefined

// 泛型约束 — 用 extends 限制
interface HasId {
  id: string;
}

function findById<T extends HasId>(items: T[], id: string): T | undefined {
  return items.find((item) => item.id === id);
}

// T 必须包含 id 属性
findById([{ id: "1", name: "Alice" }], "1"); // ✅
// findById([{ name: 'Bob' }], '1')           // ❌ 缺少 id 属性

// 多泛型参数 + keyof 约束
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}
```

---

### Q6. 什么是联合类型和交叉类型？

**面试官意图**：考察对两种核心类型组合方式的理解。

**思路分析**：从集合论角度解释"或"和"且"的关系。

**参考答案**：

```typescript
// 联合类型 (Union)：T 或 U — 集合的"并集"
type StringOrNumber = string | number;
let value: StringOrNumber = "hello"; // ✅
value = 42; // ✅

// 交叉类型 (Intersection)：T 且 U — 集合的"交集"（合并属性）
type WithTimestamp = { createdAt: Date };
type WithId = { id: string };
type Entity = WithTimestamp & WithId;
// 等价于 { createdAt: Date; id: string }
```

**注意陷阱**：

```typescript
// 基础类型的交叉可能产生 never
type Impossible = string & number; // never — 不可能同时是字符串和数字

// 对象类型的交叉是属性合并
type A = { x: number; y: number };
type B = { y: string; z: string };
type C = A & B; // { x: number; y: never; z: string }
// y 属性类型是 number & string = never
```

---

### Q7. keyof 和 typeof 操作符怎么用？

**面试官意图**：考察对类型空间操作符的掌握。

**思路分析**：区分类型空间和值空间，分别说明两个操作符的作用。

**参考答案**：

```typescript
// keyof — 获取类型的所有属性名联合
interface User {
  name: string;
  age: number;
  email: string;
}
type UserKeys = keyof User; // 'name' | 'age' | 'email'

// typeof — 从值推断类型（从值空间到类型空间的桥梁）
const config = {
  host: "localhost",
  port: 3000,
  debug: true,
} as const;

type Config = typeof config;
// { readonly host: 'localhost'; readonly port: 3000; readonly debug: true }

// keyof + typeof 组合：从对象值获取键的联合类型
type ConfigKeys = keyof typeof config; // 'host' | 'port' | 'debug'

// 实际应用：类型安全的对象访问
function getValue<T extends object, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}
```

---

### Q8. Partial, Required, Pick, Omit 如何实现？

**面试官意图**：考察对映射类型和内置工具类型原理的理解。这道题几乎是必考题。

**思路分析**：写出每个类型的源码实现，说明关键语法。

**参考答案**：

```typescript
// 1. Partial<T> — 所有属性变可选
type Partial<T> = {
  [K in keyof T]?: T[K];
  // keyof T 获取所有键
  // K in ... 遍历每个键
  // ? 添加可选标记
  // T[K] 保持原始值类型
};

// 2. Required<T> — 所有属性变必选
type Required<T> = {
  [K in keyof T]-?: T[K];
  // -? 移除可选标记（注意 - 号）
};

// 3. Pick<T, K> — 选取指定属性
type Pick<T, K extends keyof T> = {
  [P in K]: T[P];
  // K extends keyof T 约束 K 必须是 T 的键
  // P in K 只遍历选中的键
};

// 4. Omit<T, K> — 排除指定属性
type Omit<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;
// Exclude<keyof T, K> 从 T 的所有键中排除 K
// 然后用 Pick 选取剩余的键

// 使用示例
interface User {
  id: number;
  name: string;
  email: string;
  password: string;
}

type UserUpdate = Partial<User>; // 所有可选
type UserPublic = Omit<User, "password">; // 去掉 password
type UserCreate = Pick<User, "name" | "email">; // 只要 name 和 email
```

---

### Q9. 什么是类型断言？as 和 ! 有什么区别？

**面试官意图**：考察对类型断言的理解和使用风险意识。

**思路分析**：区分 `as` 类型断言和 `!` 非空断言。

**参考答案**：

```typescript
// as 类型断言 — 告诉编译器"相信我，我知道这是什么类型"
const input = document.getElementById("name") as HTMLInputElement;
input.value = "hello"; // 不加 as 会报错，因为返回类型是 HTMLElement | null

// ! 非空断言 — 告诉编译器"相信我，这不是 null/undefined"
const el = document.getElementById("app")!; // 断言不为 null
el.textContent = "loaded";

// 双重断言（应极少使用）
const value = "hello" as unknown as number; // string 不能直接断言为 number
```

**关键区别**：

- `as`：改变 TypeScript 眼中的类型，不影响运行时
- `!`：只是移除 `null | undefined`，告诉 TS "一定有值"

**风险**：两种断言都"欺骗"了编译器。如果判断错误，运行时照样崩溃。

**安全替代方案**：

```typescript
// 替代 ! 断言：用条件判断
const el = document.getElementById("app");
if (el) {
  el.textContent = "loaded"; // 安全收窄
}

// 替代 as 断言：用类型守卫
function isHTMLInputElement(el: Element): el is HTMLInputElement {
  return el.tagName === "INPUT";
}
```

---

### Q10. TypeScript 中如何处理第三方库没有类型定义的情况？

**面试官意图**：考察处理类型缺失的实际工程经验。

**思路分析**：按优先级列出解决方案。

**参考答案**：

**方案 1（优先）：安装 `@types` 包**

```bash
npm install -D @types/lodash
```

大部分流行库都有社区维护的 `@types` 包（来自 DefinitelyTyped 仓库）。

**方案 2：自己写声明文件**

```typescript
// src/types/legacy-lib.d.ts
declare module "legacy-lib" {
  export function doStuff(input: string): number;
  export interface Config {
    verbose: boolean;
    timeout: number;
  }
}
```

**方案 3：使用通配符声明（临时方案）**

```typescript
// src/types/modules.d.ts
declare module "untyped-lib"; // 所有导出都是 any
declare module "*.css"; // CSS 模块
declare module "*.svg" {
  const content: string;
  export default content;
}
```

**方案 4：在使用处添加 `@ts-ignore`（最后手段）**

```typescript
// @ts-ignore — 下一行忽略类型检查
import something from "untyped-lib";
```

**优先级**：`@types` > 自写声明 > 通配符 > `@ts-ignore`

---

## ⭐⭐ 进阶题 (Q11-Q18)

### Q11. 条件类型的分布特性是什么？

**面试官意图**：考察对条件类型核心机制的理解。

**思路分析**：解释分布触发条件 + 如何阻止分布 + 实际应用。

**参考答案**：

当条件类型中的 `T` 是**裸类型参数**（naked type parameter），且传入联合类型时，条件会自动对联合的每个成员分别应用，然后将结果联合起来。

```typescript
type ToArray<T> = T extends any ? T[] : never;

// 传入联合类型 → 自动分发
type Result = ToArray<string | number>;
// = ToArray<string> | ToArray<number>
// = string[] | number[]

// 注意：不是 (string | number)[]！
```

**分布的触发条件**：

1. `T` 必须是裸类型参数（不能被包裹）
2. `T` 处于 `extends` 的左侧
3. 传入的类型是联合类型

**如何阻止分布**：用方括号包裹 `T`

```typescript
type ToArrayNonDist<T> = [T] extends [any] ? T[] : never;

type Result2 = ToArrayNonDist<string | number>;
// = (string | number)[]  // 不分发了！
```

**实际应用**：

```typescript
// Exclude 就是利用分布特性实现的
type Exclude<T, U> = T extends U ? never : T;

type Result = Exclude<"a" | "b" | "c", "a">;
// = ('a' extends 'a' ? never : 'a') | ('b' extends 'a' ? never : 'b') | ('c' extends 'a' ? never : 'c')
// = never | 'b' | 'c'
// = 'b' | 'c'
```

---

### Q12. infer 关键字如何使用？实现 ReturnType

**面试官意图**：考察泛型推断的核心机制。

**思路分析**：解释 `infer` 的作用 + 实现 ReturnType + 延伸更多 infer 用法。

**参考答案**：

`infer` 只能在条件类型的 `extends` 子句中使用，用于"捕获"并提取出一个类型变量。

```typescript
// 实现 ReturnType — 提取函数返回类型
type MyReturnType<T extends (...args: any) => any> = T extends (
  ...args: any
) => infer R
  ? R
  : never;
//                              ↑ infer R 捕获返回类型

type A = MyReturnType<() => string>; // string
type B = MyReturnType<() => Promise<User>>; // Promise<User>

// 实现 Parameters — 提取函数参数类型
type MyParameters<T extends (...args: any) => any> = T extends (
  ...args: infer P
) => any
  ? P
  : never;

type C = MyParameters<(a: string, b: number) => void>; // [string, number]

// 提取 Promise 内部类型（递归）
type Awaited<T> = T extends Promise<infer U> ? Awaited<U> : T;

type D = Awaited<Promise<Promise<number>>>; // number

// 提取数组元素类型
type ElementOf<T> = T extends (infer E)[] ? E : never;

// 提取元组第一个元素
type Head<T extends any[]> = T extends [infer First, ...any[]] ? First : never;
type E = Head<[string, number, boolean]>; // string
```

---

### Q13. 映射类型如何工作？实现 Readonly

**面试官意图**：考察对映射类型语法和转换机制的理解。

**思路分析**：语法解释 + 实现 Readonly + 展示 as 子句重映射。

**参考答案**：

映射类型通过遍历已有类型的所有属性键，逐一变换生成新类型。

```typescript
// 语法模板：{ [K in Union]: Type }

// 实现 Readonly
type MyReadonly<T> = {
  readonly [K in keyof T]: T[K];
};

// 实现可选 Readonly（只读部分属性）
type ReadonlyPick<T, K extends keyof T> = {
  readonly [P in K]: T[P];
} & Omit<T, K>;

// as 子句重映射键名（TS 4.1+）
type Getters<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K];
};

interface User {
  name: string;
  age: number;
}
type UserGetters = Getters<User>;
// { getName: () => string; getAge: () => number }

// 过滤属性：用 as + never 移除键
type RemoveFunctions<T> = {
  [K in keyof T as T[K] extends Function ? never : K]: T[K];
};

interface Mixed {
  name: string;
  age: number;
  greet(): void;
}
type DataOnly = RemoveFunctions<Mixed>;
// { name: string; age: number }
```

---

### Q14. 模板字面量类型可以做什么？

**面试官意图**：考察对 TS 4.1+ 字符串类型运算能力的了解。

**思路分析**：展示基础语法 + 内置类型 + 实际应用场景。

**参考答案**：

模板字面量类型允许在类型层面进行字符串拼接和模式匹配：

```typescript
// 基础拼接
type Greeting = `Hello, ${string}`; // 匹配所有 "Hello, ..." 字符串
const g: Greeting = "Hello, world"; // ✅
// const g2: Greeting = 'Hi, world'  // ❌

// 联合类型自动展开（笛卡尔积）
type Color = "red" | "blue";
type Size = "sm" | "lg";
type ClassName = `${Color}-${Size}`;
// 'red-sm' | 'red-lg' | 'blue-sm' | 'blue-lg'

// 内置字符串操作类型
type A = Uppercase<"hello">; // 'HELLO'
type B = Lowercase<"HELLO">; // 'hello'
type C = Capitalize<"hello">; // 'Hello'
type D = Uncapitalize<"Hello">; // 'hello'

// 实际应用：事件系统
type EventMap = {
  click: MouseEvent;
  focus: FocusEvent;
  keydown: KeyboardEvent;
};

type EventHandler = {
  [K in keyof EventMap as `on${Capitalize<K & string>}`]: (
    e: EventMap[K],
  ) => void;
};
// { onClick: (e: MouseEvent) => void; onFocus: (e: FocusEvent) => void; onKeydown: (e: KeyboardEvent) => void }

// 模式匹配：提取路由参数
type ExtractParams<S extends string> =
  S extends `${string}:${infer Param}/${infer Rest}`
    ? { [K in Param]: string } & ExtractParams<Rest>
    : S extends `${string}:${infer Param}`
      ? { [K in Param]: string }
      : {};

type Params = ExtractParams<"/users/:userId/posts/:postId">;
// { userId: string } & { postId: string }
```

---

### Q15. TypeScript 的协变与逆变

**面试官意图**：深入考察类型安全与函数类型兼容性。

**思路分析**：用父子类型关系解释协变/逆变，然后对应到函数参数和返回值。

**参考答案**：

协变和逆变描述的是：当类型 A 是类型 B 的子类型时，由它们构造出的复合类型之间的兼容关系。

> **类比**：你有一个"能装水果的篮子"（`Basket<Fruit>`）。如果换成"能装苹果的篮子"（`Basket<Apple>`），往外拿水果没问题（协变），但往里放橘子就有风险（逆变）。

```typescript
class Animal {
  name = "";
}
class Dog extends Animal {
  bark() {}
}
class Corgi extends Dog {
  cute = true;
}
// 层级：Corgi <: Dog <: Animal

// 协变 (Covariance)：子类保持方向
// 函数返回值是协变的
type Producer<T> = () => T;

let produceDog: Producer<Dog> = () => new Dog();
let produceAnimal: Producer<Animal> = produceDog; // ✅ Dog <: Animal → Producer<Dog> <: Producer<Animal>

// 逆变 (Contravariance)：子类方向反转
// 函数参数是逆变的（在 strict 模式下）
type Consumer<T> = (value: T) => void;

let consumeAnimal: Consumer<Animal> = (a: Animal) => console.log(a.name);
let consumeDog: Consumer<Dog> = consumeAnimal; // ✅ Animal :> Dog → Consumer<Animal> <: Consumer<Dog>

// TypeScript 语法标注 (5.0+)
type Producer2<out T> = () => T; // out = 协变位置
type Consumer2<in T> = (v: T) => void; // in = 逆变位置
```

**strictFunctionTypes 的作用**：开启后函数参数严格逆变检查。关闭时参数是双变（bivariant），更宽松但不安全。

---

### Q16. 函数重载 vs 联合类型参数

**面试官意图**：考察何时应使用函数重载。

**思路分析**：对比两种方式的优劣和适用场景。

**参考答案**：

```typescript
// 方式 1：联合类型参数
function format(value: string | number): string {
  if (typeof value === "string") return value.trim();
  return value.toFixed(2);
}
// 问题：返回类型始终是 string，无法根据输入类型细化

// 方式 2：函数重载
function format(value: string): string;
function format(value: number): string;
function format(value: string | number): string {
  if (typeof value === "string") return value.trim();
  return value.toFixed(2);
}

// 重载真正有用的场景：返回类型随参数变化
function createElement(tag: "div"): HTMLDivElement;
function createElement(tag: "span"): HTMLSpanElement;
function createElement(tag: "input"): HTMLInputElement;
function createElement(tag: string): HTMLElement;
function createElement(tag: string): HTMLElement {
  return document.createElement(tag);
}

const div = createElement("div"); // HTMLDivElement
const input = createElement("input"); // HTMLInputElement
```

**选型建议**：

- 参数类型不同但返回类型相同 → 联合类型
- 返回类型随参数类型变化 → 函数重载
- 泛型 + 条件类型有时能替代重载（更灵活）

---

### Q17. 如何实现类型安全的事件系统 (EventEmitter)？

**面试官意图**：综合考察泛型、映射类型在实际设计中的运用。

**思路分析**：从接口定义 → 类型映射 → 运行时实现，展示完整方案。

**参考答案**：

```typescript
// 定义事件映射
interface EventMap {
  login: { userId: string; timestamp: number };
  logout: { userId: string };
  error: { code: number; message: string };
}

// 类型安全的 EventEmitter
class TypedEmitter<Events extends Record<string, any>> {
  private listeners = new Map<string, Set<Function>>();

  on<K extends keyof Events>(
    event: K,
    listener: (payload: Events[K]) => void,
  ): this {
    if (!this.listeners.has(event as string)) {
      this.listeners.set(event as string, new Set());
    }
    this.listeners.get(event as string)!.add(listener);
    return this;
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.listeners.get(event as string)?.forEach((fn) => fn(payload));
  }

  off<K extends keyof Events>(
    event: K,
    listener: (payload: Events[K]) => void,
  ): void {
    this.listeners.get(event as string)?.delete(listener);
  }
}

// 使用
const emitter = new TypedEmitter<EventMap>();

emitter.on("login", (data) => {
  console.log(data.userId); // ✅ 自动补全 userId, timestamp
});

emitter.emit("login", { userId: "123", timestamp: Date.now() }); // ✅
// emitter.emit('login', { wrong: true })  // ❌ 类型错误
// emitter.emit('unknown', {})             // ❌ 事件名不存在
```

---

### Q18. satisfies 操作符解决了什么问题？

**面试官意图**：考察对 TS 4.9 新语法的理解和实际应用。

**思路分析**：对比 `: Type` 注解和 `satisfies Type` 的差异。

**参考答案**：

`satisfies` 解决了一个长期痛点：**类型标注和类型推断二选一**的困境。

```typescript
type Route = Record<string, { path: string; component: string }>;

// 问题 1：用 : 注解 — 丢失具体推断
const routes: Route = {
  home: { path: "/", component: "Home" },
  about: { path: "/about", component: "About" },
};
// routes.home 的类型是 { path: string; component: string }
// 无法知道 path 具体是 '/' 还是 '/about'

// 问题 2：不注解 — 没有类型校验
const routes2 = {
  home: { path: "/", component: "Home" },
  about: { path: "/about", compnent: "About" }, // 拼写错误！没人发现
};

// ✅ satisfies：既校验又保留推断
const routes3 = {
  home: { path: "/", component: "Home" },
  about: { path: "/about", component: "About" },
} satisfies Route;

// routes3.home.path 的类型是 '/'（保留了字面量类型）
// 如果拼写错误，satisfies 会报错
```

**satisfies 的核心价值**：

1. 在编写时进行类型约束检查
2. 在使用时保留最精确的推断结果
3. 特别适合配置对象、路由表、颜色映射等场景

---

## ⭐⭐⭐ 高级题 (Q19-Q25)

### Q19. 实现 DeepPartial 类型

**面试官意图**：考察递归类型的实现能力。

**思路分析**：递归遍历对象嵌套结构，每一层都加上 `?`。需处理特殊类型（函数、数组）。

**参考答案**：

```typescript
type DeepPartial<T> = T extends Function
  ? T // 函数不处理
  : T extends Array<infer U>
    ? DeepPartialArray<U> // 数组特殊处理
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> } // 对象递归
      : T; // 基本类型直接返回

interface DeepPartialArray<T> extends Array<DeepPartial<T>> {}

// 测试
interface Config {
  server: {
    host: string;
    port: number;
    ssl: {
      enabled: boolean;
      cert: string;
    };
  };
  features: string[];
}

type PartialConfig = DeepPartial<Config>;
// {
//   server?: {
//     host?: string
//     port?: number
//     ssl?: {
//       enabled?: boolean
//       cert?: string
//     }
//   }
//   features?: DeepPartial<string>[]  // string[]（string 是基本类型，不变）
// }

// 使用场景：深度合并配置
function mergeConfig(base: Config, override: DeepPartial<Config>): Config {
  return deepMerge(base, override) as Config;
}

mergeConfig(defaultConfig, {
  server: { port: 8080 }, // ✅ 只修改 port，其他保持默认
});
```

**追问方向**：

- 如何实现 `DeepRequired`？（把 `?` 改成 `-?`）
- 如何实现 `DeepReadonly`？（加 `readonly`）
- 如何限制递归深度？（加计数器泛型参数）

---

### Q20. 实现 CamelCase 字符串类型转换

**面试官意图**：考察模板字面量类型和递归类型的综合运用。

**思路分析**：用 `infer` 匹配 `-` 分隔符，递归处理每段字符串。

**参考答案**：

```typescript
// 将 kebab-case 转为 camelCase
type CamelCase<S extends string> = S extends `${infer Head}-${infer Tail}`
  ? `${Lowercase<Head>}${CamelCaseInner<Tail>}`
  : Lowercase<S>;

type CamelCaseInner<S extends string> = S extends `${infer First}-${infer Rest}`
  ? `${Capitalize<Lowercase<First>>}${CamelCaseInner<Rest>}`
  : Capitalize<Lowercase<S>>;

// 推导过程（'border-top-width'）：
// 1. Head='border', Tail='top-width'
// 2. 'border' + CamelCaseInner<'top-width'>
// 3. CamelCaseInner<'top-width'> → First='top', Rest='width'
// 4. 'Top' + CamelCaseInner<'width'>
// 5. CamelCaseInner<'width'> → 没有 '-' → Capitalize<'width'> = 'Width'
// 6. 结果：'border' + 'Top' + 'Width' = 'borderTopWidth'

// 测试
type A = CamelCase<"background-color">; // 'backgroundColor'
type B = CamelCase<"border-top-width">; // 'borderTopWidth'
type C = CamelCase<"font-size">; // 'fontSize'
type D = CamelCase<"color">; // 'color'（无横线，不变）

// 将对象所有 kebab-case 键名转为 camelCase
type CamelCaseKeys<T extends object> = {
  [K in keyof T as K extends string ? CamelCase<K> : K]: T[K];
};

type CSSProps = {
  "background-color": string;
  "font-size": string;
  "border-radius": string;
};
type JSProps = CamelCaseKeys<CSSProps>;
// { backgroundColor: string; fontSize: string; borderRadius: string }
```

**追问方向**：

- 如何实现反向的 `KebabCase`（camelCase → kebab-case）？
- 如何同时支持 snake_case 和 kebab-case 的转换？

---

### Q21. 如何模拟名义类型 (Branded Types)？

**面试官意图**：考察对结构化类型系统局限性的理解和解决方案。

**思路分析**：解释问题 → brand 方案 → 工厂函数 → 实际应用。

**参考答案**：

**问题**：TypeScript 是结构化类型系统，结构相同的类型可以互相赋值：

```typescript
type UserId = string;
type OrderId = string;

function getUser(id: UserId) {
  /* ... */
}

const orderId: OrderId = "order-123";
getUser(orderId); // ✅ 但这是 Bug！传了订单 ID 而非用户 ID
```

**解决方案：Branded Types**

```typescript
// 方式 1：交叉类型 + 幽灵属性
type Brand<T, B extends string> = T & { readonly __brand: B };

type UserId = Brand<string, "UserId">;
type OrderId = Brand<string, "OrderId">;
type Amount = Brand<number, "Amount">;

// 工厂函数（唯一的合法构造方式）
function createUserId(id: string): UserId {
  // 可以在这里添加验证逻辑
  if (!id.startsWith("user-")) throw new Error("Invalid user ID");
  return id as UserId;
}

function createOrderId(id: string): OrderId {
  return id as OrderId;
}

// 使用
function getUser(id: UserId) {
  /* ... */
}

const userId = createUserId("user-123");
const orderId = createOrderId("order-456");

getUser(userId); // ✅
// getUser(orderId) // ❌ Type 'OrderId' is not assignable to type 'UserId'
// getUser('raw')   // ❌ 普通 string 也不行

// 方式 2：unique symbol（更严格）
declare const UserIdBrand: unique symbol;
type UserId2 = string & { readonly [UserIdBrand]: typeof UserIdBrand };
```

**实际应用场景**：

- 用户 ID / 订单 ID / 商品 ID 区分
- 金额（美元 vs 人民币）
- 经纬度（lat vs lng 不混淆）
- 已验证的字符串（ValidEmail，SanitizedHTML）

**追问方向**：

- Branded Types 的运行时开销是多少？（零，brand 属性只存在于类型层面）
- 如何跟 zod 等运行时验证库配合？

---

### Q22. TypeScript 的类型兼容性规则（结构化子类型）

**面试官意图**：深入考察类型系统核心原理。

**思路分析**：从结构化子类型 → 多余属性检查 → 函数兼容性三个层面展开。

**参考答案**：

TypeScript 的类型兼容性基于**结构化子类型（Structural Subtyping）**：只要目标类型的每个属性在源类型中都有对应的兼容属性，就认为兼容。

```typescript
interface Named {
  name: string;
}
interface Person {
  name: string;
  age: number;
}

// Person 有 Named 的所有属性（还多了 age），所以 Person <: Named
let named: Named = { name: "Alice", age: 30 } as Person; // ✅

// 多余属性检查（仅在直接对象字面量赋值时生效）
let named2: Named = { name: "Alice", age: 30 }; // ❌ 直接赋值时报错
// 这是 TS 的额外安全检查，防止拼写错误
```

**函数兼容性**：

```typescript
// 参数少的兼容参数多的（安全：忽略多余参数）
type Callback = (a: string, b: number) => void;
const fn: Callback = (a) => console.log(a); // ✅ 少一个参数没问题

// 参数类型：逆变（strict 模式下）
type Handler = (event: MouseEvent) => void;
const handler: Handler = (event: Event) => {}; // ✅ Event :> MouseEvent

// 返回值类型：协变
type Producer = () => Named;
const producer: Producer = () => ({ name: "Alice", age: 30 }); // ✅ Person <: Named
```

**追问方向**：

- 什么情况下结构化类型会造成问题？（Branded Types 的动机）
- 函数参数双变（bivariant）是什么？在哪些场景下发生？

---

### Q23. 如何用 TypeScript 实现类型安全的 Builder Pattern？

**面试官意图**：考察泛型链式调用和类型累积的高级运用。

**思路分析**：每次 `set` 调用返回一个泛型类型更宽的 Builder，最终 `build` 时拥有完整类型。

**参考答案**：

```typescript
// 目标：编译时确保所有必填字段都已设置

// 标记必填字段
interface UserConfig {
  name: string;
  email: string;
  age: number;
  role?: string;
}

// 构建器：追踪已设置的字段
type RequiredKeys = "name" | "email" | "age";

class UserBuilder<Set extends string = never> {
  private config: Partial<UserConfig> = {};

  setName(name: string): UserBuilder<Set | "name"> {
    this.config.name = name;
    return this as any;
  }

  setEmail(email: string): UserBuilder<Set | "email"> {
    this.config.email = email;
    return this as any;
  }

  setAge(age: number): UserBuilder<Set | "age"> {
    this.config.age = age;
    return this as any;
  }

  setRole(role: string): UserBuilder<Set> {
    this.config.role = role;
    return this as any;
  }

  // 只有设置了所有必填字段后才能 build
  build(this: UserBuilder<RequiredKeys>): UserConfig {
    return this.config as UserConfig;
  }
}

// 使用
const user = new UserBuilder()
  .setName("Alice")
  .setEmail("alice@example.com")
  .setAge(30)
  .build(); // ✅ 所有必填字段已设置

// const bad = new UserBuilder()
//   .setName('Bob')
//   .build()  // ❌ 编译错误！缺少 email 和 age
```

**追问方向**：

- 如何让 `build` 的错误提示更友好？（用条件类型生成缺失字段的错误信息）
- 如何支持任意顺序设置字段？（当前方案已支持）
- 生产环境中有哪些替代方案？（参数对象 + Required 约束更简洁）

---

### Q24. TypeScript 编译器的类型检查流程

**面试官意图**：考察对 TypeScript 编译器内部工作原理的了解。

**思路分析**：按编译管道的顺序依次讲解各阶段。

**参考答案**：

TypeScript 编译器（tsc）的工作分为以下主要阶段：

```
源码 (.ts/.tsx)
  ↓
Scanner（扫描器）→ Token 流
  ↓
Parser（解析器）→ AST（抽象语法树）
  ↓
Binder（绑定器）→ Symbol 表（符号绑定）
  ↓
Checker（检查器）→ 类型检查 ← 核心！最复杂的部分
  ↓
Emitter（发射器）→ .js + .d.ts + .js.map
```

**各阶段详解**：

1. **Scanner**：将源码文本转为 token 流（词法分析）
2. **Parser**：将 token 流构建为 AST，TS 的 AST 保留了类型注解节点
3. **Binder**：遍历 AST，创建 Symbol（符号）——每个声明（变量、函数、类）都对应一个 Symbol，并建立作用域链
4. **Checker**：类型检查的核心
   - 类型推断（Type Inference）：对未标注类型的表达式推导类型
   - 类型兼容性检查：赋值、函数调用时检查类型是否兼容
   - 控制流分析（CFA）：实现类型收窄
   - 泛型实例化：在调用时将类型参数替换为具体类型
5. **Emitter**：移除所有类型注解，生成 JavaScript 代码

**性能相关知识**：

- Checker 占整个编译时间的 70%+
- `skipLibCheck: true` 跳过 `.d.ts` 检查可显著加速
- `isolatedDeclarations` 允许每个文件独立生成 `.d.ts`，可并行化
- Project References 实现增量编译

**追问方向**：

- tsc 和 esbuild/swc 有什么区别？（esbuild/swc 只做转译不做类型检查）
- 如何优化大型项目的 tsc 编译速度？

---

### Q25. TypeScript 在 monorepo 中的最佳配置（Project References）

**面试官意图**：考察大型工程中 TypeScript 的项目组织能力。

**思路分析**：从痛点出发 → Project References 方案 → 配置示例 → 注意事项。

**参考答案**：

**痛点**：在 monorepo 中，多个子包互相依赖。如果用单一 tsconfig 编译所有代码：

- 编译速度慢（改一个文件重新编译所有包）
- 无法确保包之间的边界（A 包直接 import B 包的内部文件）
- IDE 性能差

**解决方案：Project References**

```diagram
monorepo/
├── tsconfig.json              # 根配置（解决方案文件）
├── tsconfig.base.json         # 共享基础配置
├── packages/
│   ├── shared/
│   │   ├── tsconfig.json
│   │   └── src/
│   ├── client/
│   │   ├── tsconfig.json
│   │   └── src/
│   └── server/
│       ├── tsconfig.json
│       └── src/
```

```jsonc
// tsconfig.base.json — 共享配置
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}

// tsconfig.json — 根（解决方案文件）
{
  "files": [],
  "references": [
    { "path": "packages/shared" },
    { "path": "packages/client" },
    { "path": "packages/server" }
  ]
}

// packages/shared/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,        // ⬅️ 必须开启
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}

// packages/client/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "references": [
    { "path": "../shared" }   // ⬅️ 声明依赖关系
  ]
}
```

**构建命令**：

```bash
# 增量构建所有项目（只编译变更的包）
tsc --build

# 强制全量重建
tsc --build --force

# 清理构建产物
tsc --build --clean
```

**核心要点**：

1. **`composite: true`**：每个子包必须开启，声明自己可以被引用
2. **`declaration: true`**：必须生成 `.d.ts`，其他包通过声明文件读取类型
3. **`declarationMap: true`**：可选，启用"跳转到源码定义"
4. **增量编译**：只有变更的包及其依赖者需要重编译
5. **边界隔离**：包 A 只能 import 包 B 的公开 API，不能直接引用内部文件

**追问方向**：

- `composite` 模式有什么限制？（必须有 `rootDir`，不能用 `noEmit`）
- 如何解决包之间的循环依赖？（提取共享类型到独立的 `types` 包）
- Project References 和 pnpm workspace 如何配合？

---

> **面试建议**：TypeScript 面试通常从基础题热身（interface vs type、any vs unknown），逐步过渡到手写工具类型（Partial/Pick/ReturnType），高级面试会要求实现类型体操或讨论工程配置。建议按 Q1→Q8→Q12→Q19 的路径重点准备，覆盖最高频考点。
