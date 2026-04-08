# AI Agent 编码题

> 涵盖 LLM 调用、Prompt 工程、RAG、Agent 框架、工具调用等 AI Agent 核心编程题，难度分层，配有完整实现和解题思路。

## 相关链接
- 对应技术资料：[编码技巧与解题策略](../../01-技术资料/09-编码题/01-编码技巧与解题策略.md)
- AI Agent技术资料：[AI-Agent全栈开发文档](../../01-技术资料/07-AI-Agent全栈开发/)

## 目录
1. [⭐ 基础题](#⭐-基础题)
2. [⭐⭐ 进阶题](#⭐⭐-进阶题)
3. [⭐⭐⭐ 高级题](#⭐⭐⭐-高级题)
4. [🎯 场景题](#🎯-场景题)

---

## ⭐ 基础题

### 1. 实现基础的 LLM 调用封装

**题目：** 封装 OpenAI API 调用，支持重试、超时、错误处理。

**思路：**
- 使用 requests 或官方 SDK
- 实现指数退避重试
- 处理常见错误

**实现（Python）：**

```python
import openai
import time
import os
from typing import Optional, List, Dict

class LLMClient:
    def __init__(self, api_key: Optional[str] = None, model: str = "gpt-4"):
        """
        初始化 LLM 客户端

        Args:
            api_key: OpenAI API Key
            model: 模型名称
        """
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        self.model = model
        self.max_retries = 3
        self.timeout = 30

        if not self.api_key:
            raise ValueError("API key is required")

        openai.api_key = self.api_key

    def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        stream: bool = False
    ) -> str:
        """
        调用 Chat Completion API

        Args:
            messages: 消息列表
            temperature: 温度参数
            max_tokens: 最大 token 数
            stream: 是否流式输出

        Returns:
            生成的文本
        """
        for attempt in range(self.max_retries):
            try:
                response = openai.ChatCompletion.create(
                    model=self.model,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    stream=stream,
                    timeout=self.timeout
                )

                if stream:
                    return self._handle_stream(response)
                else:
                    return response.choices[0].message.content

            except openai.error.RateLimitError as e:
                wait_time = (2 ** attempt) + 1  # 指数退避
                print(f"Rate limit hit, waiting {wait_time}s...")
                time.sleep(wait_time)

            except openai.error.APIError as e:
                print(f"API error: {e}")
                if attempt < self.max_retries - 1:
                    time.sleep(2)
                else:
                    raise

            except openai.error.Timeout as e:
                print(f"Request timeout: {e}")
                if attempt < self.max_retries - 1:
                    time.sleep(1)
                else:
                    raise

            except Exception as e:
                print(f"Unexpected error: {e}")
                raise

        raise Exception("Max retries exceeded")

    def _handle_stream(self, response):
        """处理流式响应"""
        full_response = ""

        for chunk in response:
            if chunk.choices[0].delta.get("content"):
                content = chunk.choices[0].delta.content
                full_response += content
                print(content, end="", flush=True)

        print()  # 换行
        return full_response

    def count_tokens(self, text: str) -> int:
        """
        估算 token 数量（简化版）
        实际应使用 tiktoken 库
        """
        return len(text) // 4

    def create_prompt(
        self,
        system: str,
        user: str,
        history: Optional[List[Dict]] = None
    ) -> List[Dict[str, str]]:
        """
        创建消息列表

        Args:
            system: 系统提示
            user: 用户输入
            history: 历史对话

        Returns:
            消息列表
        """
        messages = [{"role": "system", "content": system}]

        if history:
            messages.extend(history)

        messages.append({"role": "user", "content": user})

        return messages

# 使用示例
def main():
    client = LLMClient(model="gpt-4")

    # 简单对话
    messages = [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "What is the capital of France?"}
    ]

    response = client.chat(messages)
    print(f"Response: {response}")

    # 使用辅助方法
    messages = client.create_prompt(
        system="You are a Python expert.",
        user="Explain list comprehension in Python."
    )

    response = client.chat(messages, temperature=0.5)
    print(f"\nResponse: {response}")

    # 流式输出
    print("\nStreaming response:")
    response = client.chat(messages, stream=True)

if __name__ == "__main__":
    main()
```

**关键点：**
1. 指数退避重试策略
2. 错误分类处理
3. 流式输出支持
4. Token 计数

---

### 2. 实现 Prompt 模板系统

**题目：** 实现一个灵活的 Prompt 模板系统，支持变量替换和模板继承。

**实现：**

```python
from typing import Dict, Any, Optional
import re

class PromptTemplate:
    """Prompt 模板类"""

    def __init__(self, template: str, input_variables: Optional[list] = None):
        """
        初始化模板

        Args:
            template: 模板字符串，使用 {variable} 占位符
            input_variables: 输入变量列表
        """
        self.template = template
        self.input_variables = input_variables or self._extract_variables(template)

    def _extract_variables(self, template: str) -> list:
        """从模板中提取变量"""
        return re.findall(r'\{(\w+)\}', template)

    def format(self, **kwargs) -> str:
        """
        格式化模板

        Args:
            **kwargs: 变量值

        Returns:
            格式化后的字符串
        """
        # 检查必需变量
        missing = set(self.input_variables) - set(kwargs.keys())
        if missing:
            raise ValueError(f"Missing variables: {missing}")

        return self.template.format(**kwargs)

    def __str__(self):
        return self.template

class ChatPromptTemplate:
    """聊天 Prompt 模板"""

    def __init__(
        self,
        system_template: Optional[str] = None,
        user_template: Optional[str] = None,
        history_key: str = "history"
    ):
        self.system_template = PromptTemplate(system_template) if system_template else None
        self.user_template = PromptTemplate(user_template) if user_template else None
        self.history_key = history_key

    def format_messages(self, **kwargs) -> list:
        """
        格式化为消息列表

        Returns:
            消息列表
        """
        messages = []

        # 系统消息
        if self.system_template:
            system_content = self.system_template.format(**kwargs)
            messages.append({"role": "system", "content": system_content})

        # 历史消息
        if self.history_key in kwargs:
            messages.extend(kwargs[self.history_key])

        # 用户消息
        if self.user_template:
            user_content = self.user_template.format(**kwargs)
            messages.append({"role": "user", "content": user_content})

        return messages

class PromptLibrary:
    """Prompt 模板库"""

    def __init__(self):
        self.templates = {}

    def register(self, name: str, template: PromptTemplate):
        """注册模板"""
        self.templates[name] = template

    def get(self, name: str) -> PromptTemplate:
        """获取模板"""
        if name not in self.templates:
            raise KeyError(f"Template not found: {name}")
        return self.templates[name]

    def format(self, name: str, **kwargs) -> str:
        """格式化模板"""
        template = self.get(name)
        return template.format(**kwargs)

# 预定义模板
COMMON_TEMPLATES = {
    "summarize": PromptTemplate(
        "Please summarize the following text in {max_words} words or less:\n\n{text}"
    ),

    "translate": PromptTemplate(
        "Translate the following text from {source_lang} to {target_lang}:\n\n{text}"
    ),

    "extract_keywords": PromptTemplate(
        "Extract the top {num_keywords} keywords from the following text:\n\n{text}"
    ),

    "code_review": PromptTemplate(
        """Review the following {language} code and provide feedback on:
1. Code quality
2. Potential bugs
3. Performance improvements
4. Best practices

Code:
\`\`\`{language}
{code}
\`\`\`
"""
    )
}

# 使用示例
def main():
    # 基础模板
    template = PromptTemplate(
        "Write a {adjective} story about a {noun}."
    )

    prompt = template.format(adjective="funny", noun="robot")
    print(f"Prompt: {prompt}\n")

    # 聊天模板
    chat_template = ChatPromptTemplate(
        system_template="You are a {role}.",
        user_template="Please help me with: {task}"
    )

    messages = chat_template.format_messages(
        role="Python expert",
        task="debugging my code"
    )

    print("Chat messages:")
    for msg in messages:
        print(f"{msg['role']}: {msg['content']}")
    print()

    # 模板库
    library = PromptLibrary()
    for name, template in COMMON_TEMPLATES.items():
        library.register(name, template)

    # 使用模板库
    summary_prompt = library.format(
        "summarize",
        text="Long article text here...",
        max_words=100
    )
    print(f"Summary prompt: {summary_prompt}\n")

    translate_prompt = library.format(
        "translate",
        text="Hello, world!",
        source_lang="English",
        target_lang="French"
    )
    print(f"Translation prompt: {translate_prompt}")

if __name__ == "__main__":
    main()
```

**关键点：**
1. 变量提取和验证
2. 模板组合
3. 模板库管理
4. 聊天格式支持

---

### 3. 实现简单的 Function Calling

**题目：** 实现 LLM 工具调用（Function Calling）功能。

**实现：**

```python
import json
import openai
from typing import Callable, Dict, List, Any

class Tool:
    """工具基类"""

    def __init__(self, name: str, description: str, parameters: Dict):
        self.name = name
        self.description = description
        self.parameters = parameters

    def to_function_spec(self) -> Dict:
        """转换为 Function Calling 规范"""
        return {
            "name": self.name,
            "description": self.description,
            "parameters": self.parameters
        }

    def execute(self, **kwargs) -> Any:
        """执行工具（子类实现）"""
        raise NotImplementedError

class FunctionRegistry:
    """函数注册表"""

    def __init__(self):
        self.tools: Dict[str, Tool] = {}

    def register(self, tool: Tool):
        """注册工具"""
        self.tools[tool.name] = tool

    def get(self, name: str) -> Tool:
        """获取工具"""
        return self.tools.get(name)

    def get_specs(self) -> List[Dict]:
        """获取所有工具规范"""
        return [tool.to_function_spec() for tool in self.tools.values()]

# 示例工具
class CalculatorTool(Tool):
    """计算器工具"""

    def __init__(self):
        super().__init__(
            name="calculator",
            description="Perform basic arithmetic operations",
            parameters={
                "type": "object",
                "properties": {
                    "operation": {
                        "type": "string",
                        "enum": ["add", "subtract", "multiply", "divide"],
                        "description": "The operation to perform"
                    },
                    "a": {
                        "type": "number",
                        "description": "First number"
                    },
                    "b": {
                        "type": "number",
                        "description": "Second number"
                    }
                },
                "required": ["operation", "a", "b"]
            }
        )

    def execute(self, operation: str, a: float, b: float) -> float:
        """执行计算"""
        operations = {
            "add": lambda x, y: x + y,
            "subtract": lambda x, y: x - y,
            "multiply": lambda x, y: x * y,
            "divide": lambda x, y: x / y if y != 0 else "Error: Division by zero"
        }

        return operations[operation](a, b)

class WeatherTool(Tool):
    """天气查询工具"""

    def __init__(self):
        super().__init__(
            name="get_weather",
            description="Get the current weather for a location",
            parameters={
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "The city and state, e.g. San Francisco, CA"
                    },
                    "unit": {
                        "type": "string",
                        "enum": ["celsius", "fahrenheit"],
                        "description": "Temperature unit"
                    }
                },
                "required": ["location"]
            }
        )

    def execute(self, location: str, unit: str = "celsius") -> Dict:
        """查询天气（模拟）"""
        # 实际应调用天气 API
        return {
            "location": location,
            "temperature": 22 if unit == "celsius" else 72,
            "unit": unit,
            "condition": "Sunny"
        }

class Agent:
    """支持 Function Calling 的 Agent"""

    def __init__(self, api_key: str, model: str = "gpt-4"):
        self.api_key = api_key
        self.model = model
        self.registry = FunctionRegistry()

        openai.api_key = api_key

    def add_tool(self, tool: Tool):
        """添加工具"""
        self.registry.register(tool)

    def run(self, user_input: str, max_iterations: int = 5) -> str:
        """运行 Agent"""
        messages = [{"role": "user", "content": user_input}]

        for i in range(max_iterations):
            print(f"\n--- Iteration {i + 1} ---")

            # 调用 LLM
            response = openai.ChatCompletion.create(
                model=self.model,
                messages=messages,
                functions=self.registry.get_specs(),
                function_call="auto"
            )

            message = response.choices[0].message

            # 如果没有函数调用，返回结果
            if not message.get("function_call"):
                return message.content

            # 执行函数调用
            function_name = message.function_call.name
            function_args = json.loads(message.function_call.arguments)

            print(f"Calling function: {function_name}")
            print(f"Arguments: {function_args}")

            tool = self.registry.get(function_name)
            if not tool:
                return f"Error: Unknown function {function_name}"

            result = tool.execute(**function_args)
            print(f"Result: {result}")

            # 添加函数调用和结果到消息历史
            messages.append(message)
            messages.append({
                "role": "function",
                "name": function_name,
                "content": str(result)
            })

        return "Max iterations reached"

# 使用示例
def main():
    agent = Agent(api_key=os.getenv("OPENAI_API_KEY"))

    # 注册工具
    agent.add_tool(CalculatorTool())
    agent.add_tool(WeatherTool())

    # 测试
    queries = [
        "What is 123 + 456?",
        "What's the weather like in New York?",
        "Calculate 15 * 8 and then add 100 to the result"
    ]

    for query in queries:
        print(f"\nQuery: {query}")
        print("=" * 60)
        response = agent.run(query)
        print(f"\nFinal Answer: {response}")

if __name__ == "__main__":
    main()
```

**关键点：**
1. 工具规范定义
2. 函数调用解析
3. 迭代执行循环
4. 工具结果回传

---

## ⭐⭐ 进阶题

### 4. 实现简单的 RAG 系统

**题目：** 实现基于向量数据库的检索增强生成（RAG）系统。

**实现：**

```python
import numpy as np
from typing import List, Dict, Tuple
import openai
import faiss

class Document:
    """文档类"""

    def __init__(self, content: str, metadata: Dict = None):
        self.content = content
        self.metadata = metadata or {}
        self.embedding = None

class VectorStore:
    """向量存储"""

    def __init__(self, embedding_dim: int = 1536):
        self.embedding_dim = embedding_dim
        self.index = faiss.IndexFlatL2(embedding_dim)
        self.documents: List[Document] = []

    def add_documents(self, documents: List[Document], embeddings: np.ndarray):
        """添加文档"""
        self.index.add(embeddings.astype('float32'))
        self.documents.extend(documents)

    def search(self, query_embedding: np.ndarray, k: int = 3) -> List[Tuple[Document, float]]:
        """搜索相似文档"""
        distances, indices = self.index.search(
            query_embedding.reshape(1, -1).astype('float32'),
            k
        )

        results = []
        for distance, idx in zip(distances[0], indices[0]):
            if idx < len(self.documents):
                results.append((self.documents[idx], float(distance)))

        return results

class Embedder:
    """嵌入生成器"""

    def __init__(self, api_key: str, model: str = "text-embedding-ada-002"):
        self.api_key = api_key
        self.model = model
        openai.api_key = api_key

    def embed(self, texts: List[str]) -> np.ndarray:
        """生成嵌入向量"""
        response = openai.Embedding.create(
            model=self.model,
            input=texts
        )

        embeddings = [item['embedding'] for item in response['data']]
        return np.array(embeddings)

class RAGSystem:
    """RAG 系统"""

    def __init__(self, api_key: str, llm_model: str = "gpt-4"):
        self.api_key = api_key
        self.llm_model = llm_model
        self.embedder = Embedder(api_key)
        self.vector_store = VectorStore()

        openai.api_key = api_key

    def add_documents(self, documents: List[Document]):
        """添加文档到知识库"""
        texts = [doc.content for doc in documents]
        embeddings = self.embedder.embed(texts)
        self.vector_store.add_documents(documents, embeddings)

    def retrieve(self, query: str, k: int = 3) -> List[Document]:
        """检索相关文档"""
        query_embedding = self.embedder.embed([query])
        results = self.vector_store.search(query_embedding, k)
        return [doc for doc, _ in results]

    def generate(self, query: str, context_docs: List[Document]) -> str:
        """基于上下文生成回答"""
        # 构建上下文
        context = "\n\n".join([
            f"Document {i+1}:\n{doc.content}"
            for i, doc in enumerate(context_docs)
        ])

        # 构建 Prompt
        messages = [
            {
                "role": "system",
                "content": "You are a helpful assistant. Answer the question based on the provided context."
            },
            {
                "role": "user",
                "content": f"""Context:
{context}

Question: {query}

Please provide a comprehensive answer based on the context above."""
            }
        ]

        # 调用 LLM
        response = openai.ChatCompletion.create(
            model=self.llm_model,
            messages=messages,
            temperature=0.7
        )

        return response.choices[0].message.content

    def query(self, question: str, k: int = 3) -> Dict:
        """完整的 RAG 查询流程"""
        print(f"Query: {question}\n")

        # 1. 检索
        print("Retrieving relevant documents...")
        docs = self.retrieve(question, k)

        print(f"Found {len(docs)} relevant documents:")
        for i, doc in enumerate(docs):
            print(f"  {i+1}. {doc.content[:100]}...")
        print()

        # 2. 生成
        print("Generating answer...")
        answer = self.generate(question, docs)

        return {
            "question": question,
            "answer": answer,
            "sources": docs
        }

# 使用示例
def main():
    # 初始化 RAG 系统
    rag = RAGSystem(api_key=os.getenv("OPENAI_API_KEY"))

    # 准备文档
    documents = [
        Document("Paris is the capital of France. It is known for the Eiffel Tower."),
        Document("London is the capital of the United Kingdom. The Big Ben is a famous landmark."),
        Document("Tokyo is the capital of Japan. It is famous for its technology and culture."),
        Document("Python is a high-level programming language. It is widely used for AI development."),
        Document("Machine learning is a subset of AI. It focuses on learning from data."),
    ]

    # 添加文档到知识库
    print("Adding documents to knowledge base...")
    rag.add_documents(documents)
    print("Done!\n")

    # 查询
    queries = [
        "What is the capital of France?",
        "Tell me about programming languages used in AI."
    ]

    for query in queries:
        result = rag.query(query)
        print(f"Answer: {result['answer']}\n")
        print("=" * 60)

if __name__ == "__main__":
    main()
```

**关键点：**
1. 文档嵌入向量化
2. 向量相似度搜索
3. 上下文构建
4. LLM 生成回答

---

### 5. 实现 ReAct Agent

**题目：** 实现 ReAct（Reasoning + Acting）模式的 Agent。

**实现：**

```python
import re
from typing import List, Dict, Optional
import openai

class ReActAgent:
    """ReAct 模式的 Agent"""

    def __init__(self, api_key: str, tools: Dict[str, callable], model: str = "gpt-4"):
        self.api_key = api_key
        self.model = model
        self.tools = tools
        self.max_iterations = 10

        openai.api_key = api_key

    def _create_system_prompt(self) -> str:
        """创建系统 Prompt"""
        tool_descriptions = "\n".join([
            f"- {name}: {func.__doc__}"
            for name, func in self.tools.items()
        ])

        return f"""You are a helpful assistant that can use tools to answer questions.

Available tools:
{tool_descriptions}

Use the following format:

Thought: Think about what to do next
Action: tool_name[argument]
Observation: Result from the tool

Repeat Thought/Action/Observation as needed.
When you have enough information, provide the final answer:

Thought: I now know the final answer
Final Answer: [your answer here]

Let's begin!"""

    def _parse_action(self, text: str) -> Optional[tuple]:
        """解析 Action"""
        # 匹配格式: tool_name[argument]
        match = re.search(r'Action:\s*(\w+)\[(.*?)\]', text)
        if match:
            tool_name = match.group(1)
            argument = match.group(2).strip()
            return tool_name, argument
        return None

    def _execute_action(self, tool_name: str, argument: str) -> str:
        """执行 Action"""
        if tool_name not in self.tools:
            return f"Error: Unknown tool '{tool_name}'"

        try:
            result = self.tools[tool_name](argument)
            return str(result)
        except Exception as e:
            return f"Error executing {tool_name}: {str(e)}"

    def run(self, query: str) -> str:
        """运行 Agent"""
        system_prompt = self._create_system_prompt()
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": query}
        ]

        thoughts = []

        for i in range(self.max_iterations):
            print(f"\n--- Iteration {i + 1} ---")

            # 调用 LLM
            response = openai.ChatCompletion.create(
                model=self.model,
                messages=messages,
                temperature=0
            )

            content = response.choices[0].message.content
            print(content)

            # 检查是否完成
            if "Final Answer:" in content:
                # 提取最终答案
                final_answer = content.split("Final Answer:")[-1].strip()
                return final_answer

            # 解析并执行 Action
            action = self._parse_action(content)
            if action:
                tool_name, argument = action
                observation = self._execute_action(tool_name, argument)

                print(f"\nObservation: {observation}")

                # 添加观察结果
                messages.append({"role": "assistant", "content": content})
                messages.append({
                    "role": "user",
                    "content": f"Observation: {observation}\n\nContinue your reasoning."
                })
            else:
                # 没有 Action，继续
                messages.append({"role": "assistant", "content": content})
                messages.append({
                    "role": "user",
                    "content": "Continue your reasoning."
                })

        return "Max iterations reached without finding answer"

# 示例工具
def search(query: str) -> str:
    """Search the web for information"""
    # 模拟搜索
    search_results = {
        "python": "Python is a high-level programming language created by Guido van Rossum in 1991.",
        "ai": "Artificial Intelligence (AI) is the simulation of human intelligence by machines.",
        "weather": "The weather today is sunny with a temperature of 72°F."
    }

    for key in search_results:
        if key in query.lower():
            return search_results[key]

    return "No results found"

def calculate(expression: str) -> str:
    """Calculate a mathematical expression"""
    try:
        result = eval(expression)
        return str(result)
    except:
        return "Invalid expression"

def get_current_date() -> str:
    """Get the current date"""
    from datetime import datetime
    return datetime.now().strftime("%Y-%m-%d")

# 使用示例
def main():
    tools = {
        "search": search,
        "calculate": calculate,
        "get_current_date": get_current_date
    }

    agent = ReActAgent(
        api_key=os.getenv("OPENAI_API_KEY"),
        tools=tools
    )

    queries = [
        "What is Python and when was it created?",
        "What is 15 * 23 + 100?",
        "Search for information about AI and then calculate 2^10"
    ]

    for query in queries:
        print(f"\n{'=' * 80}")
        print(f"Query: {query}")
        print('=' * 80)

        answer = agent.run(query)

        print(f"\n{'=' * 80}")
        print(f"Final Answer: {answer}")
        print('=' * 80)

if __name__ == "__main__":
    main()
```

**关键点：**
1. Thought-Action-Observation 循环
2. 动作解析和执行
3. 工具调用集成
4. 迭代推理过程

---

## ⭐⭐⭐ 高级题

### 6. 实现多 Agent 协作系统

**题目：** 实现多个 Agent 协作完成复杂任务。

**实现：**

```python
from typing import List, Dict
from enum import Enum
import openai

class AgentRole(Enum):
    """Agent 角色"""
    PLANNER = "planner"
    RESEARCHER = "researcher"
    WRITER = "writer"
    CRITIC = "critic"

class Message:
    """消息"""

    def __init__(self, sender: str, content: str, message_type: str = "text"):
        self.sender = sender
        self.content = content
        self.message_type = message_type

class BaseAgent:
    """Agent 基类"""

    def __init__(self, name: str, role: AgentRole, api_key: str):
        self.name = name
        self.role = role
        self.api_key = api_key
        self.model = "gpt-4"

        openai.api_key = api_key

    def _get_system_prompt(self) -> str:
        """获取系统 Prompt（子类实现）"""
        raise NotImplementedError

    def process(self, context: List[Message], task: str) -> str:
        """处理任务"""
        messages = [{"role": "system", "content": self._get_system_prompt()}]

        # 添加上下文
        for msg in context:
            messages.append({
                "role": "user" if msg.sender != self.name else "assistant",
                "content": f"[{msg.sender}]: {msg.content}"
            })

        # 添加当前任务
        messages.append({"role": "user", "content": task})

        response = openai.ChatCompletion.create(
            model=self.model,
            messages=messages,
            temperature=0.7
        )

        return response.choices[0].message.content

class PlannerAgent(BaseAgent):
    """规划 Agent"""

    def _get_system_prompt(self) -> str:
        return """You are a planning agent. Your role is to:
1. Break down complex tasks into subtasks
2. Identify what information is needed
3. Create a step-by-step plan

Output your plan as a numbered list."""

class ResearcherAgent(BaseAgent):
    """研究 Agent"""

    def _get_system_prompt(self) -> str:
        return """You are a research agent. Your role is to:
1. Gather relevant information
2. Fact-check claims
3. Provide comprehensive context

Output your findings in a structured format."""

class WriterAgent(BaseAgent):
    """写作 Agent"""

    def _get_system_prompt(self) -> str:
        return """You are a writing agent. Your role is to:
1. Create clear, engaging content
2. Structure information logically
3. Adapt tone for the audience

Output well-formatted text."""

class CriticAgent(BaseAgent):
    """评论 Agent"""

    def _get_system_prompt(self) -> str:
        return """You are a critic agent. Your role is to:
1. Identify weaknesses in the output
2. Suggest improvements
3. Ensure quality standards

Provide constructive feedback."""

class MultiAgentSystem:
    """多 Agent 协作系统"""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.agents = {}
        self.conversation_history: List[Message] = []

        # 初始化 Agents
        self._setup_agents()

    def _setup_agents(self):
        """设置 Agents"""
        self.agents = {
            AgentRole.PLANNER: PlannerAgent("Planner", AgentRole.PLANNER, self.api_key),
            AgentRole.RESEARCHER: ResearcherAgent("Researcher", AgentRole.RESEARCHER, self.api_key),
            AgentRole.WRITER: WriterAgent("Writer", AgentRole.WRITER, self.api_key),
            AgentRole.CRITIC: CriticAgent("Critic", AgentRole.CRITIC, self.api_key)
        }

    def _add_message(self, sender: str, content: str):
        """添加消息到历史"""
        self.conversation_history.append(Message(sender, content))

    def run(self, task: str) -> str:
        """运行多 Agent 协作"""
        print(f"\n{'=' * 80}")
        print(f"Task: {task}")
        print('=' * 80)

        # 1. 规划阶段
        print("\n[Phase 1: Planning]")
        planner = self.agents[AgentRole.PLANNER]
        plan = planner.process(self.conversation_history, f"Create a plan to: {task}")
        print(f"\nPlanner: {plan}")
        self._add_message("Planner", plan)

        # 2. 研究阶段
        print("\n[Phase 2: Research]")
        researcher = self.agents[AgentRole.RESEARCHER]
        research = researcher.process(
            self.conversation_history,
            f"Based on the plan, gather necessary information for: {task}"
        )
        print(f"\nResearcher: {research}")
        self._add_message("Researcher", research)

        # 3. 写作阶段
        print("\n[Phase 3: Writing]")
        writer = self.agents[AgentRole.WRITER]
        draft = writer.process(
            self.conversation_history,
            f"Based on the research, write content for: {task}"
        )
        print(f"\nWriter: {draft}")
        self._add_message("Writer", draft)

        # 4. 评论阶段
        print("\n[Phase 4: Review]")
        critic = self.agents[AgentRole.CRITIC]
        feedback = critic.process(
            self.conversation_history,
            "Review the written content and provide feedback."
        )
        print(f"\nCritic: {feedback}")
        self._add_message("Critic", feedback)

        # 5. 修订阶段
        print("\n[Phase 5: Revision]")
        final_draft = writer.process(
            self.conversation_history,
            "Revise the content based on the critic's feedback."
        )
        print(f"\nFinal Draft: {final_draft}")

        return final_draft

# 使用示例
def main():
    system = MultiAgentSystem(api_key=os.getenv("OPENAI_API_KEY"))

    tasks = [
        "Write a blog post about the benefits of AI in healthcare",
        "Create a product description for a smart home device"
    ]

    for task in tasks:
        result = system.run(task)
        print(f"\n{'=' * 80}")
        print("Final Output:")
        print('=' * 80)
        print(result)

if __name__ == "__main__":
    main()
```

**关键点：**
1. 角色分工明确
2. 消息传递机制
3. 协作流程设计
4. 迭代改进

---

## 🎯 场景题

### 7. 实现智能客服系统

**题目：** 实现一个支持意图识别、多轮对话、工单创建的智能客服系统。

**实现：**

```python
from typing import List, Dict, Optional
from enum import Enum
import openai
import json

class Intent(Enum):
    """意图类型"""
    GREETING = "greeting"
    PRODUCT_INQUIRY = "product_inquiry"
    COMPLAINT = "complaint"
    ORDER_STATUS = "order_status"
    TECHNICAL_SUPPORT = "technical_support"
    HUMAN_HANDOFF = "human_handoff"

class ConversationState:
    """对话状态"""

    def __init__(self):
        self.intent: Optional[Intent] = None
        self.context: Dict = {}
        self.messages: List[Dict] = []
        self.resolved: bool = False

class Ticket:
    """工单"""

    def __init__(self, ticket_id: str, issue_type: str, description: str):
        self.ticket_id = ticket_id
        self.issue_type = issue_type
        self.description = description
        self.status = "open"
        self.priority = "normal"

class CustomerServiceBot:
    """智能客服机器人"""

    def __init__(self, api_key: str, kb_docs: List[str] = None):
        self.api_key = api_key
        self.kb_docs = kb_docs or []
        self.sessions: Dict[str, ConversationState] = {}
        self.tickets: List[Ticket] = []

        openai.api_key = api_key

    def _classify_intent(self, message: str) -> Intent:
        """意图分类"""
        prompt = f"""Classify the customer's intent from this message:
"{message}"

Choose from:
- greeting: General greetings
- product_inquiry: Questions about products
- complaint: Complaints or dissatisfaction
- order_status: Questions about order status
- technical_support: Technical issues
- human_handoff: Request for human agent

Return only the intent name."""

        response = openai.ChatCompletion.create(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )

        intent_name = response.choices[0].message.content.strip().lower()
        try:
            return Intent(intent_name)
        except ValueError:
            return Intent.GREETING

    def _generate_response(
        self,
        state: ConversationState,
        user_message: str
    ) -> str:
        """生成回复"""
        # 构建系统 Prompt
        system_prompt = """You are a helpful customer service assistant.
Your goal is to:
1. Understand customer needs
2. Provide accurate information
3. Resolve issues efficiently
4. Escalate to human agents when necessary

Be polite, professional, and empathetic."""

        # 添加知识库上下文
        if self.kb_docs:
            kb_context = "\n".join(self.kb_docs)
            system_prompt += f"\n\nKnowledge Base:\n{kb_context}"

        # 构建消息历史
        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(state.messages)
        messages.append({"role": "user", "content": user_message})

        # 调用 LLM
        response = openai.ChatCompletion.create(
            model="gpt-4",
            messages=messages,
            temperature=0.7
        )

        return response.choices[0].message.content

    def _create_ticket(
        self,
        session_id: str,
        issue_type: str,
        description: str
    ) -> Ticket:
        """创建工单"""
        ticket_id = f"TICKET-{len(self.tickets) + 1:04d}"
        ticket = Ticket(ticket_id, issue_type, description)
        self.tickets.append(ticket)

        print(f"\n[System] Created ticket: {ticket_id}")
        return ticket

    def _extract_order_id(self, message: str) -> Optional[str]:
        """提取订单号"""
        # 简化实现，实际应使用正则或 NER
        if "order" in message.lower():
            import re
            match = re.search(r'#(\d+)', message)
            if match:
                return match.group(1)
        return None

    def chat(self, session_id: str, user_message: str) -> str:
        """处理用户消息"""
        # 获取或创建会话状态
        if session_id not in self.sessions:
            self.sessions[session_id] = ConversationState()

        state = self.sessions[session_id]

        # 意图识别
        intent = self._classify_intent(user_message)
        state.intent = intent

        print(f"\n[Intent] {intent.value}")

        # 根据意图处理
        if intent == Intent.GREETING:
            response = "Hello! How can I help you today?"

        elif intent == Intent.ORDER_STATUS:
            order_id = self._extract_order_id(user_message)
            if order_id:
                # 模拟订单查询
                response = f"Let me check order #{order_id} for you. Your order is currently being processed and will ship within 2-3 business days."
            else:
                response = "I'd be happy to check your order status. Could you please provide your order number?"

        elif intent == Intent.COMPLAINT:
            # 创建工单
            ticket = self._create_ticket(
                session_id,
                "complaint",
                user_message
            )
            response = f"I'm sorry to hear about your experience. I've created ticket {ticket.ticket_id} to track this issue. A specialist will review it shortly. Is there anything else I can help you with?"

        elif intent == Intent.TECHNICAL_SUPPORT:
            # 尝试自动解决
            response = self._generate_response(state, user_message)

            # 如果无法解决，创建工单
            if "can't help" in response.lower() or "don't know" in response.lower():
                ticket = self._create_ticket(
                    session_id,
                    "technical_support",
                    user_message
                )
                response += f"\n\nI've created ticket {ticket.ticket_id} for our technical team to investigate further."

        elif intent == Intent.HUMAN_HANDOFF:
            response = "I understand you'd like to speak with a human agent. Let me transfer you to our support team. Please hold for a moment."
            state.resolved = True

        else:
            response = self._generate_response(state, user_message)

        # 更新对话历史
        state.messages.append({"role": "user", "content": user_message})
        state.messages.append({"role": "assistant", "content": response})

        return response

    def get_ticket(self, ticket_id: str) -> Optional[Ticket]:
        """获取工单"""
        for ticket in self.tickets:
            if ticket.ticket_id == ticket_id:
                return ticket
        return None

# 使用示例
def main():
    # 准备知识库
    kb_docs = [
        "Product return policy: Items can be returned within 30 days of purchase.",
        "Shipping: Standard shipping takes 3-5 business days. Express shipping takes 1-2 days.",
        "Payment methods: We accept credit cards, PayPal, and bank transfers."
    ]

    bot = CustomerServiceBot(
        api_key=os.getenv("OPENAI_API_KEY"),
        kb_docs=kb_docs
    )

    # 模拟对话
    session_id = "user123"

    conversations = [
        "Hi, I need help with my order",
        "I ordered a laptop last week but haven't received it yet. Order #12345",
        "The product I received is damaged. I want a refund",
        "Thanks for your help"
    ]

    print("=" * 80)
    print("Customer Service Chat")
    print("=" * 80)

    for message in conversations:
        print(f"\nCustomer: {message}")
        response = bot.chat(session_id, message)
        print(f"Bot: {response}")

    # 显示创建的工单
    print("\n" + "=" * 80)
    print("Created Tickets:")
    print("=" * 80)
    for ticket in bot.tickets:
        print(f"\nTicket ID: {ticket.ticket_id}")
        print(f"Type: {ticket.issue_type}")
        print(f"Status: {ticket.status}")
        print(f"Description: {ticket.description}")

if __name__ == "__main__":
    main()
```

**关键点：**
1. 意图识别
2. 多轮对话状态管理
3. 知识库集成
4. 工单系统
5. 人工转接

---

## 总结

AI Agent 编码题考察 LLM 应用开发、Prompt 工程、RAG、多 Agent 协作等实战能力。

**学习建议：**
1. 熟练掌握 LLM API 调用
2. 理解 Prompt 工程技巧
3. 掌握向量数据库和 RAG
4. 熟悉 Agent 框架（LangChain、AutoGPT）
5. 实践多 Agent 协作模式

**设计原则：**
1. 清晰的 Prompt 设计
2. 有效的上下文管理
3. 工具和函数调用
4. 错误处理和重试
5. 成本和性能优化

**扩展阅读：**
- OpenAI API 文档
- LangChain 文档
- Prompt Engineering Guide
- AI Agent 论文
- RAG 最佳实践
