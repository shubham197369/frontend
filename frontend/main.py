from datetime import datetime, timedelta
import os
import shutil
import sqlite3
from typing import Optional
import bcrypt
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
import jwt
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_community.vectorstores import Chroma
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pydantic import BaseModel
from pypdf import PdfReader
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Security & Auth Configuration ---
SECRET_KEY = "shubham_enterprise_secret_key_super_secure"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 1 day

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/login")

# फिक्स डायरेक्टरी
PERSIST_DIRECTORY = "./chroma_db"
vector_store = None

print("Loading local model and tokenizer (flan-t5-base)...")
tokenizer = AutoTokenizer.from_pretrained("google/flan-t5-base")
model = AutoModelForSeq2SeqLM.from_pretrained("google/flan-t5-base")


# --- Direct Bcrypt Helper Functions (Fixes 72-byte & Passlib error) ---
def verify_password(plain_password: str, hashed_password: str) -> bool:
    password_bytes = plain_password.encode("utf-8")[:72]
    return bcrypt.checkpw(password_bytes, hashed_password.encode("utf-8"))


def get_password_hash(password: str) -> str:
    password_bytes = password.encode("utf-8")[:72]
    return bcrypt.hashpw(password_bytes, bcrypt.gensalt()).decode("utf-8")


# --- Database Setup (Users & Auth) ---
def init_db():
    conn = sqlite3.connect("enterprise_auth.db")
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL,
            password_changed_at TEXT NOT NULL
        )
    """)
    conn.commit()

    # Default Admin Create करें
    cursor.execute("SELECT * FROM users WHERE username = 'admin'")
    if not cursor.fetchone():
        hashed_pwd = get_password_hash("admin123")
        now = datetime.now().isoformat()
        cursor.execute(
            "INSERT INTO users (username, password_hash, role, password_changed_at) VALUES (?, ?, ?, ?)",
            ("admin", hashed_pwd, "admin", now),
        )
        conn.commit()
    conn.close()


init_db()


# --- Pydantic Models ---
class QueryRequest(BaseModel):
    question: str


class UserCreate(BaseModel):
    username: str
    password: str
    role: str


class UserRegisterSchema(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


class Token(BaseModel):
    access_token: str
    token_type: str
    role: str


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        role: str = payload.get("role")
        if username is None:
            raise credentials_exception
        return {"username": username, "role": role}
    except jwt.PyJWTError:
        raise credentials_exception


# --- API Endpoints ---
@app.get("/")
def read_root():
    return {"message": "Local Enterprise Knowledge Copilot API with Auth is running!"}


# --- Register Endpoint (Connected to Database & Frontend) ---
@app.post("/register")
def register_user(user: UserRegisterSchema):
    conn = sqlite3.connect("enterprise_auth.db")
    cursor = conn.cursor()
    
    # Check if username already exists
    cursor.execute("SELECT id FROM users WHERE username = ?", (user.username,))
    if cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail="Username already registered.")
    
    try:
        hashed_pwd = get_password_hash(user.password)
        now = datetime.now().isoformat()
        # Self-registered users get default 'viewer' role
        cursor.execute(
            "INSERT INTO users (username, password_hash, role, password_changed_at) VALUES (?, ?, ?, ?)",
            (user.username, hashed_pwd, "viewer", now),
        )
        conn.commit()
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    
    conn.close()
    return {"message": "User registered successfully!"}


@app.post("/api/login", response_model=Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends()):
    conn = sqlite3.connect("enterprise_auth.db")
    cursor = conn.cursor()
    cursor.execute(
        "SELECT username, password_hash, role FROM users WHERE username = ?",
        (form_data.username,),
    )
    user = cursor.fetchone()
    conn.close()

    if not user or not verify_password(form_data.password, user[1]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user[0], "role": user[2]}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer", "role": user[2]}


# --- New API: Get Registered Users (Admin Only) ---
@app.get("/api/users")
async def get_users(current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "admin":
        raise HTTPException(
            status_code=403, detail="Access Denied: Only Admin can view users list."
        )

    conn = sqlite3.connect("enterprise_auth.db")
    cursor = conn.cursor()
    cursor.execute("SELECT username, role FROM users")
    rows = cursor.fetchall()
    conn.close()

    users_list = [{"username": row[0], "role": row[1]} for row in rows]
    return users_list


# --- New API: Change Password ---
@app.post("/api/change-password")
async def change_password(
    req: ChangePasswordRequest, current_user: dict = Depends(get_current_user)
):
    username = current_user["username"]

    conn = sqlite3.connect("enterprise_auth.db")
    cursor = conn.cursor()
    cursor.execute(
        "SELECT password_hash FROM users WHERE username = ?", (username,)
    )
    user = cursor.fetchone()

    if not user or not verify_password(req.old_password, user[0]):
        conn.close()
        raise HTTPException(status_code=400, detail="Incorrect old password.")

    new_hashed_pwd = get_password_hash(req.new_password)
    now = datetime.now().isoformat()

    cursor.execute(
        "UPDATE users SET password_hash = ?, password_changed_at = ? WHERE username = ?",
        (new_hashed_pwd, now, username),
    )
    conn.commit()
    conn.close()

    return {"message": "Password updated successfully!"}


@app.post("/api/admin/create-user")
async def create_user(
    user_data: UserCreate, current_user: dict = Depends(get_current_user)
):
    if current_user["role"] != "admin":
        raise HTTPException(
            status_code=403, detail="Only admin can create new users."
        )

    if user_data.role not in ["admin", "viewer"]:
        raise HTTPException(
            status_code=400, detail="Invalid role. Use 'admin' or 'viewer'."
        )

    conn = sqlite3.connect("enterprise_auth.db")
    cursor = conn.cursor()
    try:
        hashed_pwd = get_password_hash(user_data.password)
        now = datetime.now().isoformat()
        cursor.execute(
            "INSERT INTO users (username, password_hash, role, password_changed_at) VALUES (?, ?, ?, ?)",
            (user_data.username, hashed_pwd, user_data.role, now),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        raise HTTPException(status_code=400, detail="Username already registered.")
    conn.close()

    return {
        "message": f"User '{user_data.username}' with role '{user_data.role}' created successfully!"
    }


@app.post("/api/upload")
async def upload_pdf(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    if current_user["role"] != "admin":
        raise HTTPException(
            status_code=403,
            detail="Access Denied: Only Admin can upload/index documents.",
        )

    global vector_store
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed.")

    try:
        await file.seek(0)
        pdf_reader = PdfReader(file.file)
        extracted_text = ""
        for page in pdf_reader.pages:
            text = page.extract_text()
            if text:
                extracted_text += text + "\n"

        if not extracted_text.strip():
            extracted_text = f"Document '{file.filename}' extracted."

        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000, chunk_overlap=150
        )
        chunks = text_splitter.split_text(extracted_text)

        embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

        vector_store = None
        if os.path.exists(PERSIST_DIRECTORY):
            try:
                shutil.rmtree(PERSIST_DIRECTORY)
            except Exception:
                pass

        vector_store = Chroma.from_texts(
            texts=chunks, embedding=embeddings, persist_directory=PERSIST_DIRECTORY
        )

        return {
            "filename": file.filename,
            "total_pages": len(pdf_reader.pages),
            "total_chunks": len(chunks),
            "status": "Indexed and Saved into Vector DB successfully!",
        }
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to process PDF: {str(e)}"
        )


@app.post("/api/query")
async def query_doc(
    request: QueryRequest, current_user: dict = Depends(get_current_user)
):
    global vector_store

    if not vector_store:
        try:
            if os.path.exists(PERSIST_DIRECTORY):
                embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
                vector_store = Chroma(
                    persist_directory=PERSIST_DIRECTORY, embedding_function=embeddings
                )
        except Exception:
            pass

    if not vector_store:
        raise HTTPException(
            status_code=400, detail="Please upload a PDF document first."
        )

    docs = vector_store.similarity_search(request.question, k=3)
    context = "\n\n".join([doc.page_content for doc in docs])

    ai_answer = "LLM generation failed."
    try:
        prompt = f"""Answer the question based only on the context provided. Be direct and complete.

Context:
{context}

Question: {request.question}
Answer:"""

        inputs = tokenizer(prompt, return_tensors="pt", max_length=512, truncation=True)
        outputs = model.generate(
            **inputs,
            max_new_tokens=250,
            do_sample=False,
            num_beams=4,
            no_repeat_ngram_size=3,
        )
        ai_answer = tokenizer.decode(outputs[0], skip_special_tokens=True)

    except Exception as e:
        ai_answer = (
            f"**[Error Details]**: {str(e)}\n\n**[Fallback Chunks]**:\n"
            + "\n".join([f"• {d.page_content}" for d in docs])
        )

    return {
        "user": current_user["username"],
        "role": current_user["role"],
        "question": request.question,
        "ai_answer": ai_answer,
        "relevant_chunks": [doc.page_content for doc in docs],
    }