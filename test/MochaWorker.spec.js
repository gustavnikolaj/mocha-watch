const expect = require("unexpected");
const EventEmitter = require("events");
const { resolve } = require("path");
const MochaWorker = require("../lib/MochaWorker");

const originalChildProcessSpawn = MochaWorker.childProcessSpawn;

describe("MochaWorker", () => {
  it("should be a constructor", () => {
    const mochaWorker = new MochaWorker();

    expect(mochaWorker, "to be a", MochaWorker);
  });

  it("should set instance variables", () => {
    const mochaWorker = new MochaWorker({ foo: true, bar: 1 }, [
      "--reporter",
      "dot",
      "a.spec.js",
      "b.spec.js"
    ]);

    expect(mochaWorker, "to exhaustively satisfy", {
      args: ["--reporter", "dot", "a.spec.js", "b.spec.js"],
      mochaOpts: { foo: true, bar: 1 },
      state: "stopped"
    });
  });

  describe("#generateArgs", () => {
    it("should take supplied args and add generated files", () => {
      const mochaWorker = new MochaWorker(
        {
          spec: ["a.spec.js", "b.spec.js"]
        },
        ["--reporter", "dot", "a.spec.js", "b.spec.js"]
      );

      expect(mochaWorker.generateArgs(["b.spec.js"]), "to equal", [
        "--reporter",
        "dot",
        "b.spec.js"
      ]);
    });

    it("should include any newly discovered files", () => {
      const mochaWorker = new MochaWorker(
        {
          spec: ["a.spec.js", "b.spec.js"]
        },
        ["--reporter", "dot", "a.spec.js", "b.spec.js"]
      );

      expect(mochaWorker.generateArgs(["c.spec.js"]), "to equal", [
        "--reporter",
        "dot",
        "c.spec.js"
      ]);
    });
  });

  describe("#runTests", () => {
    afterEach(() => {
      MochaWorker.childProcessSpawn = originalChildProcessSpawn;
    });

    it("should call spawn with the correct arguments", () => {
      const mochaWorker = new MochaWorker(
        {
          spec: ["a.spec.js", "b.spec.js"]
        },
        ["--reporter", "dot", "a.spec.js", "b.spec.js"]
      );
      mochaWorker.generateArgs = () => ["--reporter", "dot", "c.spec.js"];
      const calls = [];
      MochaWorker.childProcessSpawn = (...args) => {
        calls.push(args);
        throw new Error("ignore");
      };

      return expect(
        () => mochaWorker.runTests(["c.spec.js"]),
        "to be rejected"
      ).then(() => {
        expect(calls, "to satisfy", [
          [
            resolve(__dirname, "..", "node_modules", "mocha/bin/mocha"),
            ["--reporter", "dot", "c.spec.js"],
            {
              stdio: "inherit"
            }
          ]
        ]);
      });
    });

    it("should transition into the started state", () => {
      const mochaWorker = new MochaWorker(
        {
          spec: ["a.spec.js", "b.spec.js"]
        },
        ["--reporter", "dot", "a.spec.js", "b.spec.js"]
      );
      mochaWorker.generateArgs = () => ["--reporter", "dot", "c.spec.js"];
      let emitter;
      MochaWorker.childProcessSpawn = () => {
        emitter = new EventEmitter();
        return emitter;
      };

      const workerPromise = mochaWorker.runTests(["c.spec.js"]);

      return expect(mochaWorker, "to satisfy", {
        state: "started"
      }).finally(() => {
        emitter.emit("close");
        return workerPromise;
      });
    });

    it("should resolve and transition into the stopped state on close", () => {
      const mochaWorker = new MochaWorker(
        {
          spec: ["a.spec.js", "b.spec.js"]
        },
        ["--reporter", "dot", "a.spec.js", "b.spec.js"]
      );
      mochaWorker.generateArgs = () => ["--reporter", "dot", "c.spec.js"];
      let emitter;
      MochaWorker.childProcessSpawn = () => {
        emitter = new EventEmitter();
        setImmediate(() => {
          emitter.emit("close", 127);
        });
        return emitter;
      };

      const workerPromise = mochaWorker.runTests(["c.spec.js"]);

      return expect(workerPromise, "to be fulfilled with", {
        exitCode: 127,
        testDuration: expect.it("to be a number")
      }).then(() => {
        expect(mochaWorker, "to satisfy", { state: "stopped" });
      });
    });

    it("should resolve immediately if no files are supplied", () => {
      const mochaWorker = new MochaWorker(
        {
          spec: ["a.spec.js", "b.spec.js"]
        },
        ["--reporter", "dot", "a.spec.js", "b.spec.js"]
      );

      const calls = [];
      MochaWorker.childProcessSpawn = (...args) => {
        calls.push(args);
      };

      const workerPromise = mochaWorker.runTests([]);

      return expect(workerPromise, "to be fulfilled").then(() => {
        expect(calls, "to be empty");
      });
    });

    it("should reject and transition into the stopped state on spawn failure", () => {
      const mochaWorker = new MochaWorker(
        {
          spec: ["a.spec.js", "b.spec.js"]
        },
        ["--reporter", "dot", "a.spec.js", "b.spec.js"]
      );
      mochaWorker.generateArgs = () => ["--reporter", "dot", "c.spec.js"];
      const error = new Error("fail");
      MochaWorker.childProcessSpawn = () => {
        throw error;
      };

      const workerPromise = mochaWorker.runTests(["c.spec.js"]);

      return expect(workerPromise, "to be rejected with", error).then(() => {
        expect(mochaWorker, "to satisfy", { state: "stopped" });
      });
    });

    it("should reject if a test run is already in progress", () => {
      const mochaWorker = new MochaWorker(
        {
          spec: ["a.spec.js", "b.spec.js"]
        },
        ["--reporter", "dot", "a.spec.js", "b.spec.js"]
      );

      mochaWorker.state = "started";

      const workerPromise = mochaWorker.runTests(["c.spec.js"]);

      return expect(workerPromise, "to be rejected with", "Already running.");
    });
  });
});
