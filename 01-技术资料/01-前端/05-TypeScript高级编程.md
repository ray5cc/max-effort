# TypeScript 高级编程

> 从类型系统原理到高级类型体操，从工程配置到设计模式，掌握 TypeScript 在大型项目中的深度应用。

## 相关链接

- 对应面试题：[TypeScript面试题](../../02-面试指南/01-前端面试/05-TypeScript面试题.md)
- 相关技术资料：[JavaScript核心与ES6+](./02-JavaScript核心与ES6+.md)

## 目录

1. [为什么需要 TypeScript](#1-为什么需要-typescript)
2. [类型系统基础](#2-类型系统基础)
3. [高级类型](#3-高级类型)
4. [泛型深度解析](#4-泛型深度解析)
5. [类型体操实战](#5-类型体操实战)
6. [工具类型源码解析](#6-工具类型源码解析)
7. [声明文件与模块系统](#7-声明文件与模块系统)
8. [tsconfig 配置详解](#8-tsconfig-配置详解)
9. [TypeScript 5.x 新特性（2025-2026）](#9-typescript-5x-新特性2025-2026)
10. [设计模式与最佳实践](#10-设计模式与最佳实践)

---

## 1. 为什么需要 TypeScript

### 1.1 JavaScript 动态类型的痛点

JavaScript 是一门动态弱类型语言。代码在编写时不需要指定变量类型，一切类型错误都推迟到运行时才暴露。这在小型脚本中无伤大雅，但当项目规模增长到数十万行代码时，问题就会集中爆发：

```javascript
// 一个典型的运行时错误，代码审查很难发现
function getUser(id) {
  return fetch(`/api/users/${id}`).then((r) => r.json());
}

// 调用者误以为返回 User，实际上是 Promise<User>
const user = getUser(1);
console.log(user.name); // ❌ 运行时报错：Cannot read property 'name' of Promise
```

这类错误的共同特征是：**写的时候没问题，跑的时候才炸**。而 TypeScript 能在你敲下代码的瞬间就标红告警。

### 1.2 TypeScript = 编程的"安检门"

> **类比**：把 JavaScript 项目想象成一座机场。没有 TypeScript 时，所有旅客（数据）直接冲向登机口，违禁品（类型错误）直到飞机起飞（代码运行）才被发现。TypeScript 就是编程的"安检门"——在代码"起飞"之前，就把潜在的类型问题一一拦截。

TypeScript 不会改变 JavaScript 的运行方式（因为它最终编译为 JS），而是在**编译期**增加了一层静态分析。这带来三大好处：

1. **更早发现 Bug**：编辑器输入时即提示错误，而非用户投诉时才发现
2. **更强的自文档能力**：类型注解本身就是最精准的 API 文档
3. **更好的开发体验**：自动补全、跳转定义、重构重命名——IDE 能力全面释放

### 1.3 结构化类型 vs 名义类型

TypeScript 采用**结构化类型系统（Structural Typing）**，即"形状匹配"——只要你长得像鸭子、走起来像鸭子，我就认为你是鸭子（Duck Typing 的编译期版本）：

```typescript
interface Point {
  x: number;
  y: number;
}
interface Coordinate {
  x: number;
  y: number;
}

const p: Point = { x: 1, y: 2 };
const c: Coordinate = p; // ✅ 完全合法！结构兼容即可
```

而 Java/C# 使用**名义类型系统（Nominal Typing）**，即使两个类结构完全相同，不同名字就是不同类型。TypeScript 的结构化类型让代码更灵活，但有时需要手动模拟名义类型（见第 10 节 Branded Types）。

### 1.4 设计哲学：渐进式类型化

TypeScript 不强迫你一步到位。你可以在现有 JS 项目中逐步添加 `.ts` 文件，将 `strict` 模式从关闭逐步开启，甚至用 `// @ts-ignore` 临时跳过难缠的类型问题。这种**渐进式（Gradual）**设计哲学是 TypeScript 能在工业界大规模普及的关键。

---

## 2. 类型系统基础

### 2.1 基础类型

TypeScript 的类型系统建立在 JavaScript 的 8 种运行时类型之上，并增加了编译期专属类型：

```typescript
// --- JavaScript 运行时类型的 TS 表示 ---
let str: string = "hello";
let num: number = 42;
let bool: boolean = true;
let n: null = null;
let u: undefined = undefined;
let sym: symbol = Symbol("id");
let big: bigint = 100n;

// --- TypeScript 编译期专属类型 ---
let a: any; // 关闭类型检查，"万能逃生舱"
let unk: unknown; // 安全的 any，使用前必须收窄
let nev: never; // 永远不会有值（函数抛异常/无限循环）
let v: void; // 函数无返回值
```

### 2.2 对象类型：interface vs type 深层对比

这是面试最高频问题之一。两者 90% 的场景可互换，但有关键差异：

| 对比维度     | `interface`                | `type`                   |
| ------------ | -------------------------- | ------------------------ |
| 声明合并     | ✅ 同名自动合并            | ❌ 报错                  |
| extends 继承 | ✅ `interface B extends A` | ⚠️ 用 `&` 交叉代替       |
| 联合 / 交叉  | ❌ 不支持                  | ✅ `type C = A \| B`     |
| 映射类型     | ❌ 不支持                  | ✅ `{ [K in ...]: ... }` |
| 计算属性     | ❌ 不支持                  | ✅ 支持                  |
| 编译器性能   | ✅ 更优（命名缓存）        | ⚠️ 复杂类型可能慢        |

**最佳实践**：

- 定义对象形状、类的契约 → 用 `interface`
- 联合类型、交叉类型、工具类型 → 用 `type`
- 需要声明合并（如扩展第三方库类型）→ 必须用 `interface`

```typescript
// interface：声明合并
interface Window {
  myGlobal: string; // 自动合并到全局 Window 类型
}

// type：支持复杂类型运算
type StringOrNumber = string | number;
type ApiResult<T> = { data: T; error: null } | { data: null; error: Error };
```

### 2.3 数组与元组

```typescript
// 数组：同类型元素集合
const names: string[] = ["Alice", "Bob"];
const ids: Array<number> = [1, 2, 3]; // 泛型写法

// 元组：固定长度、每位类型可不同
const pair: [string, number] = ["age", 25];

// 带标签的元组（TS 4.0+），提升可读性
type UserTuple = [name: string, age: number, active: boolean];
const user: UserTuple = ["Alice", 30, true];

// 可选元素 + 剩余元素
type LogEntry = [timestamp: number, level: string, ...messages: string[]];
```

### 2.4 枚举：const enum vs enum

```typescript
// 普通枚举 → 编译后保留为对象
enum Direction {
  Up = "UP",
  Down = "DOWN",
}
// 编译后: var Direction; (function(Direction) { ... })(Direction || ...)

// const 枚举 → 编译后完全内联，无运行时开销
const enum Status {
  Active = 1,
  Inactive = 0,
}
const s = Status.Active; // 编译后直接变成: const s = 1
```

**建议**：优先使用 `const enum`（零运行时开销），或直接用 `as const` 对象替代：

```typescript
const Direction = { Up: "UP", Down: "DOWN" } as const;
type Direction = (typeof Direction)[keyof typeof Direction]; // 'UP' | 'DOWN'
```

### 2.5 类型层级金字塔：any vs unknown vs never

```
          any (顶部，接受一切)
            │
         unknown (安全的顶部类型)
        ┌───┼───┐
     string number boolean ... (具体类型)
        └───┼───┘
         never (底部，空集)
```

- **`any`**：关闭所有类型检查，任何操作都不报错 → 仅用于迁移遗留代码
- **`unknown`**：接受任何赋值，但使用前必须收窄 → 替代 `any` 的安全选择
- **`never`**：不可能存在的类型（函数永远不返回 / 条件分支穷举后的 else）

```typescript
// unknown 必须收窄后才能使用
function processInput(input: unknown) {
  if (typeof input === "string") {
    console.log(input.toUpperCase()); // ✅ 收窄为 string
  }
  // input.toUpperCase()  // ❌ 直接使用会报错
}

// never 用于穷举检查
type Shape = "circle" | "square";
function getArea(shape: Shape) {
  switch (shape) {
    case "circle":
      return Math.PI * 10 ** 2;
    case "square":
      return 10 * 10;
    default:
      const _exhaustive: never = shape; // 如果漏掉分支，编译报错
      return _exhaustive;
  }
}
```

---

## 3. 高级类型

### 3.1 联合类型与交叉类型

```typescript
// 联合类型 (Union)：A 或 B
type ID = string | number;

// 交叉类型 (Intersection)：A 且 B（合并所有属性）
type Timestamped<T> = T & { createdAt: Date; updatedAt: Date };

interface User {
  name: string;
  email: string;
}
type TimestampedUser = Timestamped<User>;
// 等价于 { name: string; email: string; createdAt: Date; updatedAt: Date }
```

### 3.2 类型收窄 (Narrowing)

> **类比**：类型收窄像机场的多道"安检关卡"——每过一关，就淘汰一批不符合条件的类型，最终只剩下你真正想要的那个确定类型。

TypeScript 的控制流分析（Control Flow Analysis）能自动根据条件判断收窄类型：

```typescript
// 1. typeof 收窄
function padLeft(value: string | number) {
  if (typeof value === "string") {
    return value.padStart(4, " "); // TS 知道是 string
  }
  return value.toFixed(2); // TS 知道是 number
}

// 2. instanceof 收窄
function logError(err: Error | string) {
  if (err instanceof Error) {
    console.log(err.stack); // TS 知道有 stack
  } else {
    console.log(err); // TS 知道是 string
  }
}

// 3. in 操作符收窄
interface Bird {
  fly(): void;
}
interface Fish {
  swim(): void;
}
function move(animal: Bird | Fish) {
  if ("fly" in animal) {
    animal.fly();
  } else {
    animal.swim();
  }
}

// 4. 判别联合 (Discriminated Unions) — 最强大的收窄方式
type ApiResponse<T> =
  | { status: "success"; data: T }
  | { status: "error"; message: string }
  | { status: "loading" };

function handleResponse<T>(res: ApiResponse<T>) {
  switch (res.status) {
    case "success":
      console.log(res.data); // ✅ TS 知道有 data
      break;
    case "error":
      console.error(res.message); // ✅ TS 知道有 message
      break;
    case "loading":
      console.log("加载中..."); // ✅ 无额外属性
      break;
  }
}
```

**自定义类型守卫**（Type Predicate）：

```typescript
function isString(value: unknown): value is string {
  return typeof value === "string";
}

// 使用后，TS 会自动收窄类型
function process(input: unknown) {
  if (isString(input)) {
    console.log(input.toUpperCase()); // ✅ 自动收窄为 string
  }
}
```

### 3.3 条件类型 (Conditional Types)

条件类型是 TypeScript 类型系统的 "if-else"：

```typescript
// 语法：T extends U ? X : Y
type IsString<T> = T extends string ? true : false;

type A = IsString<"hello">; // true
type B = IsString<42>; // false
```

**分布特性（Distributive Conditional Types）**：当 `T` 是联合类型时，条件类型会自动对每个成员分别应用：

```typescript
type ToArray<T> = T extends any ? T[] : never;

// 联合类型自动分发：
type Result = ToArray<string | number>;
// = ToArray<string> | ToArray<number>
// = string[] | number[]
// 注意：不是 (string | number)[]！

// 阻止分布：用方括号包裹
type ToArrayNonDist<T> = [T] extends [any] ? T[] : never;
type Result2 = ToArrayNonDist<string | number>; // (string | number)[]
```

### 3.4 映射类型 (Mapped Types)

遍历已有类型的所有属性，逐一变换：

```typescript
// 语法：{ [K in keyof T]: NewType }
type Optional<T> = { [K in keyof T]?: T[K] };
type ReadonlyType<T> = { readonly [K in keyof T]: T[K] };

// 配合条件类型和模板字面量
type Getters<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K];
};

interface Person {
  name: string;
  age: number;
}
type PersonGetters = Getters<Person>;
// { getName: () => string; getAge: () => number }
```

### 3.5 模板字面量类型 (Template Literal Types)

TypeScript 4.1+ 引入的强大字符串操作能力：

```typescript
// 基础用法
type EventName = `on${Capitalize<"click" | "focus" | "blur">}`;
// 'onClick' | 'onFocus' | 'onBlur'

// 内置字符串操作类型
type Upper = Uppercase<"hello">; // 'HELLO'
type Lower = Lowercase<"HELLO">; // 'hello'
type Cap = Capitalize<"hello">; // 'Hello'
type Uncap = Uncapitalize<"Hello">; // 'hello'

// 实战：CSS 属性名转 camelCase
type CSSProperty = "background-color" | "font-size" | "border-radius";
// 转换后：'backgroundColor' | 'fontSize' | 'borderRadius'
// （实现见第 5 节类型体操）
```

### 3.6 索引类型：keyof 与 T[K]

```typescript
interface User {
  name: string;
  age: number;
  email: string;
}

type UserKeys = keyof User; // 'name' | 'age' | 'email'
type UserName = User["name"]; // string

// 安全的属性访问函数
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}

const user: User = { name: "Alice", age: 30, email: "a@b.com" };
const name = getProperty(user, "name"); // string
// getProperty(user, 'address')  // ❌ 编译错误
```

---

## 4. 泛型深度解析

### 4.1 泛型基础

> **类比**：泛型就像工厂里的**可调模具**——模具的形状（逻辑）不变，但可以调整尺寸（类型）来生产不同产品。你不需要为每种尺寸造一个新模具，一个可调模具就够了。

```typescript
// 泛型函数
function identity<T>(value: T): T {
  return value;
}
const str = identity("hello"); // 自动推断为 string
const num = identity(42); // 自动推断为 number

// 泛型接口
interface Repository<T> {
  findById(id: string): Promise<T>;
  findAll(): Promise<T[]>;
  save(entity: T): Promise<void>;
}

// 泛型类
class Stack<T> {
  private items: T[] = [];
  push(item: T): void {
    this.items.push(item);
  }
  pop(): T | undefined {
    return this.items.pop();
  }
  peek(): T | undefined {
    return this.items[this.items.length - 1];
  }
}

const numberStack = new Stack<number>();
numberStack.push(1);
numberStack.push(2);
// numberStack.push('a')  // ❌ 类型错误
```

### 4.2 约束 (Constraints)

用 `extends` 限制泛型参数的范围：

```typescript
interface HasLength {
  length: number;
}

// T 必须具有 length 属性
function logLength<T extends HasLength>(value: T): number {
  console.log(value.length);
  return value.length;
}

logLength("hello"); // ✅ string 有 length
logLength([1, 2, 3]); // ✅ array 有 length
// logLength(42)        // ❌ number 没有 length

// 多约束
function merge<T extends object, U extends object>(a: T, b: U): T & U {
  return { ...a, ...b };
}
```

### 4.3 默认类型参数

```typescript
// 像函数的默认参数一样，给类型参数设默认值
interface ApiResponse<T = unknown, E = Error> {
  data: T | null;
  error: E | null;
  statusCode: number;
}

// 使用默认值
const res1: ApiResponse = {
  data: null,
  error: new Error("fail"),
  statusCode: 500,
};
// 覆盖默认值
const res2: ApiResponse<User> = {
  data: { name: "Alice", email: "" },
  error: null,
  statusCode: 200,
};
```

### 4.4 推断 (infer)

`infer` 关键字只能在条件类型的 `extends` 子句中使用，用于"捕获"一个类型：

```typescript
// 提取函数返回类型
type MyReturnType<T> = T extends (...args: any[]) => infer R ? R : never;

type A = MyReturnType<() => string>; // string
type B = MyReturnType<(x: number) => boolean>; // boolean

// 提取函数参数类型
type MyParameters<T> = T extends (...args: infer P) => any ? P : never;

type C = MyParameters<(a: string, b: number) => void>; // [string, number]

// 提取 Promise 内部类型
type UnwrapPromise<T> = T extends Promise<infer U> ? UnwrapPromise<U> : T;

type D = UnwrapPromise<Promise<Promise<string>>>; // string（递归解包）

// 提取数组元素类型
type ElementOf<T> = T extends (infer E)[] ? E : never;
type E = ElementOf<string[]>; // string
```

### 4.5 实战：类型安全的 API 客户端

```typescript
// 定义 API 路由表
interface ApiRoutes {
  "/users": {
    GET: { response: User[]; query: { page: number; limit: number } };
    POST: { response: User; body: { name: string; email: string } };
  };
  "/users/:id": {
    GET: { response: User; params: { id: string } };
    PUT: { response: User; params: { id: string }; body: Partial<User> };
    DELETE: { response: void; params: { id: string } };
  };
  "/posts": {
    GET: { response: Post[]; query: { authorId?: string } };
  };
}

// 类型安全的请求函数
type Method = "GET" | "POST" | "PUT" | "DELETE";

type RouteConfig<
  P extends keyof ApiRoutes,
  M extends keyof ApiRoutes[P],
> = ApiRoutes[P][M];

async function request<
  P extends keyof ApiRoutes,
  M extends keyof ApiRoutes[P] & Method,
>(
  path: P,
  method: M,
  options?: Omit<RouteConfig<P, M>, "response">,
): Promise<(RouteConfig<P, M> & { response: unknown })["response"]> {
  // 实际实现省略，关注类型签名
  const res = await fetch(String(path), { method: String(method) });
  return res.json();
}

// 使用：完全类型安全
const users = await request("/users", "GET", { query: { page: 1, limit: 10 } });
// users 的类型是 User[] ✅

const newUser = await request("/users", "POST", {
  body: { name: "Bob", email: "b@b.com" },
});
// newUser 的类型是 User ✅
```

### 4.6 泛型常见陷阱

```typescript
// ❌ 陷阱 1：不必要的泛型
function bad<T>(x: T): T { return x }  // 等同于 identity，但如果不需要保持类型关联就别用

// ❌ 陷阱 2：泛型约束过宽
function process<T extends object>(obj: T) { ... }  // object 太宽，尽量用更具体的约束

// ❌ 陷阱 3：忘记泛型参数的分布特性
type Wrong<T> = T extends any ? T[] : never
type R = Wrong<string | number>  // string[] | number[]，不是 (string | number)[]

// ✅ 正确做法
type Right<T> = [T] extends [any] ? T[] : never
type R2 = Right<string | number>  // (string | number)[]
```

---

## 5. 类型体操实战

类型体操是用 TypeScript 类型系统进行"编程"——在编译期完成复杂的类型计算。以下是从易到难的经典实现。

### 5.1 DeepReadonly

**需求**：将对象及其所有嵌套属性都变为 `readonly`。

```typescript
type DeepReadonly<T> = T extends Function
  ? T // 函数类型不处理
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T; // 基本类型直接返回

// 逐步推导：
// DeepReadonly<{ a: { b: number }; fn: () => void }>
// → { readonly a: DeepReadonly<{ b: number }>; readonly fn: () => void }
// → { readonly a: { readonly b: DeepReadonly<number> }; readonly fn: () => void }
// → { readonly a: { readonly b: number }; readonly fn: () => void }

// 测试
interface Config {
  db: { host: string; port: number };
  features: string[];
}
type ReadonlyConfig = DeepReadonly<Config>;
// { readonly db: { readonly host: string; readonly port: number }; readonly features: readonly string[] }
```

### 5.2 TupleToUnion

**需求**：将元组类型转为联合类型。

```typescript
type TupleToUnion<T extends readonly any[]> = T[number];

// 推导：
// T[number] → 索引访问类型，获取数组所有数字索引位置的类型联合
type Result = TupleToUnion<[string, number, boolean]>; // string | number | boolean
```

### 5.3 Flatten

**需求**：将嵌套数组类型展平一层。

```typescript
type Flatten<T extends any[]> = T extends [infer First, ...infer Rest]
  ? First extends any[]
    ? [...Flatten<First>, ...Flatten<Rest>]
    : [First, ...Flatten<Rest>]
  : T;

// 推导：
// Flatten<[1, [2, 3], [4, [5]]]>
// → [1, ...Flatten<[2, 3]>, ...Flatten<[[4, [5]]]>]
// → [1, 2, 3, 4, [5]]  // 只展平一层

// 深度展平版本
type DeepFlatten<T extends any[]> = T extends [infer First, ...infer Rest]
  ? First extends any[]
    ? [...DeepFlatten<First>, ...DeepFlatten<Rest>]
    : [First, ...DeepFlatten<Rest>]
  : T;
```

### 5.4 CamelCase（字符串类型操作）

**需求**：将 `kebab-case` 字符串类型转为 `camelCase`。

```typescript
// 核心思路：遇到 `-x` 就把 x 大写，递归处理剩余部分
type CamelCase<S extends string> = S extends `${infer Head}-${infer Tail}`
  ? `${Lowercase<Head>}${CamelCaseInner<Tail>}`
  : Lowercase<S>;

// 内部递归：每次遇到 - 就大写下一个字符
type CamelCaseInner<S extends string> = S extends `${infer First}-${infer Rest}`
  ? `${Capitalize<Lowercase<First>>}${CamelCaseInner<Rest>}`
  : Capitalize<Lowercase<S>>;

// 测试
type A = CamelCase<"background-color">; // 'backgroundColor'
type B = CamelCase<"border-top-width">; // 'borderTopWidth'
type C = CamelCase<"font-size">; // 'fontSize'
```

**推导过程**（以 `'background-color'` 为例）：

```
CamelCase<'background-color'>
→ Head='background', Tail='color'
→ `${Lowercase<'background'>}${CamelCaseInner<'color'>}`
→ `background${Capitalize<Lowercase<'color'>>}`
→ `background${'Color'}`
→ 'backgroundColor'
```

### 5.5 ParseQueryString（高级模板字面量）

**需求**：解析 URL 查询字符串类型为对象类型。

```typescript
// 解析单个 key=value
type ParseParam<S extends string> = S extends `${infer Key}=${infer Value}`
  ? { [K in Key]: Value }
  : never;

// 解析完整查询字符串
type ParseQueryString<S extends string> =
  S extends `${infer Param}&${infer Rest}`
    ? ParseParam<Param> & ParseQueryString<Rest>
    : ParseParam<S>;

// 测试
type Q = ParseQueryString<"name=alice&age=25&active=true">;
// { name: 'alice' } & { age: '25' } & { active: 'true' }

// 简化结果（展平交叉类型）
type Simplify<T> = { [K in keyof T]: T[K] };
type QSimple = Simplify<Q>;
// { name: 'alice'; age: '25'; active: 'true' }
```

---

## 6. 工具类型源码解析

TypeScript 内置了约 20 个工具类型，分为三大类。理解它们的实现原理，是掌握类型体操的基础。

### 6.1 结构变换类

```typescript
// Partial<T>：所有属性变可选
type Partial<T> = { [K in keyof T]?: T[K] };

// Required<T>：所有属性变必选（-? 移除可选标记）
type Required<T> = { [K in keyof T]-?: T[K] };

// Readonly<T>：所有属性变只读
type Readonly<T> = { readonly [K in keyof T]: T[K] };

// Pick<T, K>：选取指定属性
type Pick<T, K extends keyof T> = { [P in K]: T[P] };

// Omit<T, K>：排除指定属性（基于 Pick + Exclude 组合）
type Omit<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;

// Record<K, V>：构造键值对象
type Record<K extends keyof any, V> = { [P in K]: V };
```

**使用场景**：

```typescript
interface User {
  id: number;
  name: string;
  email: string;
  password: string;
}

type UserUpdate = Partial<User>; // 更新接口，所有字段可选
type UserPublic = Omit<User, "password">; // 公开信息，去掉密码
type UserCreate = Pick<User, "name" | "email">; // 创建接口，只需名字和邮箱
type UserMap = Record<string, User>; // 用户字典
```

### 6.2 集合操作类

```typescript
// Exclude<T, U>：从 T 中排除可赋值给 U 的类型
type Exclude<T, U> = T extends U ? never : T;
// Exclude<'a' | 'b' | 'c', 'a'> → 'b' | 'c'

// Extract<T, U>：从 T 中提取可赋值给 U 的类型
type Extract<T, U> = T extends U ? T : never;
// Extract<'a' | 'b' | 'c', 'a' | 'b'> → 'a' | 'b'

// NonNullable<T>：排除 null 和 undefined
type NonNullable<T> = T extends null | undefined ? never : T;
// NonNullable<string | null | undefined> → string
```

### 6.3 函数提取类

```typescript
// ReturnType<T>：提取函数返回类型
type ReturnType<T extends (...args: any) => any> = T extends (
  ...args: any
) => infer R
  ? R
  : any;

// Parameters<T>：提取函数参数类型（元组）
type Parameters<T extends (...args: any) => any> = T extends (
  ...args: infer P
) => any
  ? P
  : never;

// ConstructorParameters<T>：提取构造函数参数类型
type ConstructorParameters<T extends abstract new (...args: any) => any> =
  T extends abstract new (...args: infer P) => any ? P : never;

// InstanceType<T>：提取构造函数实例类型
type InstanceType<T extends abstract new (...args: any) => any> =
  T extends abstract new (...args: any) => infer R ? R : any;
```

```typescript
// 实际使用
function createUser(name: string, age: number): User {
  /* ... */
}

type Params = Parameters<typeof createUser>; // [string, number]
type Return = ReturnType<typeof createUser>; // User

class MyService {
  constructor(
    private db: Database,
    private logger: Logger,
  ) {}
}
type ServiceParams = ConstructorParameters<typeof MyService>; // [Database, Logger]
```

---

## 7. 声明文件与模块系统

### 7.1 .d.ts 声明文件的作用

声明文件（`.d.ts`）只包含类型信息，不包含实现。它们是 TypeScript 与 JavaScript 世界之间的桥梁：

```typescript
// types/env.d.ts — 声明环境变量类型
declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: "development" | "production" | "test";
    DATABASE_URL: string;
    API_KEY: string;
  }
}

// 使用时完全类型安全
const env = process.env.NODE_ENV; // 'development' | 'production' | 'test'
```

### 7.2 三斜杠指令 vs import

```typescript
// 三斜杠指令（旧方式，仅在特定场景使用）
/// <reference types="node" />
/// <reference path="./legacy-types.d.ts" />

// import 方式（推荐）
import type { Request, Response } from "express";
```

**何时用三斜杠指令**：

- 全局类型声明文件（没有 import/export 的 `.d.ts`）
- 引用 `lib.*` 类型（如 `/// <reference lib="dom" />`）

### 7.3 扩展第三方库类型

```typescript
// 扩展 Express 的 Request 类型
declare module "express" {
  interface Request {
    user?: { id: string; role: "admin" | "user" };
  }
}

// 为无类型的 JS 库创建声明
declare module "legacy-lib" {
  export function doSomething(input: string): number;
  export class Helper {
    constructor(config: { verbose: boolean });
    run(): Promise<void>;
  }
}
```

### 7.4 DefinitelyTyped 和 @types/\*

当第三方库没有内置类型时，社区维护的 [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) 仓库提供了类型声明：

```bash
# 安装类型声明
npm install -D @types/lodash @types/express @types/node

# TypeScript 自动从 node_modules/@types/ 加载声明
```

**类型查找优先级**：

1. 库自身的类型（`package.json` 中的 `types` 字段）
2. `@types/*` 包
3. 项目中自定义的 `.d.ts` 文件

---

## 8. tsconfig 配置详解

### 8.1 strict 系列（强烈推荐全开）

```jsonc
{
  "compilerOptions": {
    "strict": true, // 开启以下所有严格选项

    // 等价于：
    "strictNullChecks": true, // null/undefined 不能赋给其他类型
    "strictFunctionTypes": true, // 函数参数逆变检查
    "strictBindCallApply": true, // 严格检查 bind/call/apply 参数
    "strictPropertyInitialization": true, // 类属性必须初始化
    "noImplicitAny": true, // 禁止隐式 any
    "noImplicitThis": true, // 禁止隐式 this=any
    "alwaysStrict": true, // 每个文件加 "use strict"

    // 额外推荐（strict 不包含）：
    "noUncheckedIndexedAccess": true, // 索引访问结果包含 undefined
    "noImplicitOverride": true, // 子类重写必须加 override 关键字
    "exactOptionalPropertyTypes": true, // 可选属性不允许显式赋 undefined
  },
}
```

### 8.2 paths 别名与 baseUrl

```jsonc
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@components/*": ["src/components/*"],
      "@utils/*": ["src/utils/*"],
      "@types/*": ["src/types/*"],
    },
  },
}
```

> 注意：`paths` 只影响 TypeScript 的类型解析，实际运行时的模块解析需要通过构建工具（Vite/Webpack）或 `tsconfig-paths` 配合。

### 8.3 项目引用 (Project References)

在 monorepo 中，每个子包独立编译、增量构建：

```jsonc
// tsconfig.json（根目录）
{
  "references": [
    { "path": "packages/shared" },
    { "path": "packages/client" },
    { "path": "packages/server" }
  ]
}

// packages/shared/tsconfig.json
{
  "compilerOptions": {
    "composite": true,      // 必须开启
    "declaration": true,     // 生成 .d.ts
    "declarationMap": true,  // 生成声明映射（跳转定义用）
    "outDir": "dist"
  }
}
```

### 8.4 模块解析策略

```jsonc
{
  "compilerOptions": {
    // target：编译目标
    "target": "ES2022", // 目标 JS 版本

    // module：模块输出格式
    "module": "ESNext", // ES 模块

    // moduleResolution：模块查找算法
    "moduleResolution": "Bundler", // 推荐（2024+）
    // "Node16"  — 适用于 Node.js 原生 ESM
    // "Bundler" — 适用于 Vite/Webpack 等打包工具
    // "node"    — 旧版，不推荐
  },
}
```

**选择指南**：

- 纯 Node.js 项目 → `"Node16"` + `"module": "Node16"`
- Vite/Next.js/Webpack → `"Bundler"` + `"module": "ESNext"`
- 库开发（同时支持 ESM/CJS）→ `"Node16"` + `"module": "Node16"`

---

## 9. TypeScript 5.x 新特性（2025-2026）

### 9.1 const Type Parameters (5.0)

让泛型参数自动推断为字面量类型：

```typescript
// 没有 const：推断为宽泛类型
function routes<T extends readonly string[]>(paths: T): T {
  return paths;
}
const r1 = routes(["/", "/about"]); // string[]

// 有 const：推断为字面量元组
function routesConst<const T extends readonly string[]>(paths: T): T {
  return paths;
}
const r2 = routesConst(["/", "/about"]); // readonly ['/', '/about']
```

### 9.2 Decorators (5.0) — ECMAScript Stage 3

TypeScript 5.0 支持了符合 ECMAScript Stage 3 标准的装饰器语法（与旧版 `experimentalDecorators` 不同）：

```typescript
function log(target: any, context: ClassMethodDecoratorContext) {
  const methodName = String(context.name);
  function replacement(this: any, ...args: any[]) {
    console.log(`[LOG] ${methodName} called with:`, args);
    return target.call(this, ...args);
  }
  return replacement;
}

class UserService {
  @log
  getUser(id: string) {
    return { id, name: "Alice" };
  }
}
```

### 9.3 satisfies 操作符 (4.9)

既能进行类型检查，又不丢失字面量推断：

```typescript
type Colors = Record<string, [number, number, number] | string>;

// 用 : 标注 → 丢失具体类型
const palette1: Colors = {
  red: [255, 0, 0],
  green: "#00ff00",
};
palette1.red.toUpperCase(); // ❌ 编译器不知道 red 是数组

// 用 satisfies → 既检查又保留具体推断
const palette2 = {
  red: [255, 0, 0],
  green: "#00ff00",
} satisfies Colors;
palette2.red[0]; // ✅ 知道是 [number, number, number]
palette2.green.toUpperCase(); // ✅ 知道是 string
```

### 9.4 using 声明 (5.2) — Explicit Resource Management

基于 ECMAScript `Symbol.dispose` 提案，实现类似 C# `using` / Python `with` 的资源管理：

```typescript
class DatabaseConnection {
  [Symbol.dispose]() {
    console.log("连接已关闭");
    // 清理资源
  }
}

function query() {
  using conn = new DatabaseConnection();
  // 使用 conn 查询数据库...
  // 函数结束时自动调用 conn[Symbol.dispose]()
}

// 异步版本
class AsyncFile {
  async [Symbol.asyncDispose]() {
    await this.flush();
    await this.close();
  }
}

async function processFile() {
  await using file = new AsyncFile();
  // 异步清理
}
```

### 9.5 隔离声明 (5.5) — --isolatedDeclarations

要求每个文件能独立生成 `.d.ts`，无需全局类型推断。这使得声明文件生成可以并行化（不依赖 tsc，可用 swc/esbuild 加速）：

```typescript
// ✅ 显式标注返回类型（满足 isolatedDeclarations）
export function add(a: number, b: number): number {
  return a + b;
}

// ❌ 缺少返回类型标注
export function add(a: number, b: number) {
  return a + b; // 需要全局推断才能确定返回类型
}
```

### 9.6 区域类型收窄 (5.7+)

TypeScript 5.7+ 增强了控制流分析，支持更多场景的自动类型收窄，包括：

- 对 `Map.has()` 后的 `Map.get()` 自动收窄
- 对 `Set.has()` 后的值自动收窄
- 更精确的交叉类型收窄

```typescript
const map = new Map<string, number>();
if (map.has("key")) {
  const value = map.get("key"); // TS 5.7+: number（而非 number | undefined）
}
```

---

## 10. 设计模式与最佳实践

### 10.1 Branded Types（名义类型模拟）

TypeScript 的结构化类型有时过于灵活——用户 ID 和订单 ID 都是 `string`，但不应混用：

```typescript
// 使用 brand 标记实现名义类型
type Brand<T, B extends string> = T & { readonly __brand: B };

type UserId = Brand<string, "UserId">;
type OrderId = Brand<string, "OrderId">;

// 工厂函数创建 branded 值
function createUserId(id: string): UserId {
  return id as UserId;
}
function createOrderId(id: string): OrderId {
  return id as OrderId;
}

function getUser(id: UserId) {
  /* ... */
}

const userId = createUserId("user-123");
const orderId = createOrderId("order-456");

getUser(userId); // ✅
// getUser(orderId) // ❌ 类型不兼容！
// getUser('raw')   // ❌ 原始 string 也不行
```

### 10.2 Builder Pattern with Fluent API

```typescript
class QueryBuilder<T extends object = {}> {
  private conditions: Record<string, unknown> = {};

  where<K extends string, V>(key: K, value: V): QueryBuilder<T & Record<K, V>> {
    this.conditions[key] = value;
    return this as any;
  }

  build(): T {
    return this.conditions as T;
  }
}

// 链式调用，类型逐步累积
const query = new QueryBuilder()
  .where("name", "Alice") // QueryBuilder<{ name: string }>
  .where("age", 30) // QueryBuilder<{ name: string; age: number }>
  .where("active", true) // QueryBuilder<{ name: string; age: number; active: boolean }>
  .build();
// query 的类型：{ name: string; age: number; active: boolean }
```

### 10.3 Type-level Validation

在编译期进行约束验证：

```typescript
// 确保数组非空
type NonEmptyArray<T> = [T, ...T[]];

function firstElement<T>(arr: NonEmptyArray<T>): T {
  return arr[0]; // 安全！类型保证至少有一个元素
}

firstElement([1, 2, 3]); // ✅
// firstElement([])       // ❌ 编译错误

// 确保字符串非空
type NonEmptyString<S extends string> = S extends "" ? never : S;

function greet<S extends string>(name: NonEmptyString<S>) {
  console.log(`Hello, ${name}`);
}

greet("Alice"); // ✅
// greet('')    // ❌ 编译错误
```

### 10.4 常见反模式

```typescript
// ❌ 1. any 滥用：关闭类型检查
function parse(data: any) {
  return data.name;
} // 运行时可能崩溃
// ✅ 用 unknown + 收窄
function parse(data: unknown) {
  if (typeof data === "object" && data !== null && "name" in data) {
    return (data as { name: string }).name;
  }
  throw new Error("Invalid data");
}

// ❌ 2. 类型断言滥用
const user = {} as User; // 运行时 user 没有任何属性！
// ✅ 用工厂函数或验证库（如 zod）

// ❌ 3. enum 过度使用
enum Status {
  Active,
  Inactive,
} // 运行时有开销
// ✅ 用联合类型替代
type Status = "active" | "inactive";

// ❌ 4. 忽略 strictNullChecks
// ✅ 始终开启 strict 模式
```

---

> **总结**：TypeScript 的类型系统是图灵完备的——理论上可以进行任意复杂的类型运算。但在实际项目中，应该在"类型安全"和"代码可读性"之间找到平衡。优先使用内置工具类型，只在确实需要时才写复杂类型体操。记住：**类型是为人服务的，不是为了炫技**。
