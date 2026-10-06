import uvicorn

from app import config

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="127.0.0.1", port=config.PORT, reload=False)
