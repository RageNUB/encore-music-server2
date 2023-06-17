const express = require('express');
const cors = require('cors');
require('dotenv').config()
const jwt = require('jsonwebtoken');
const stripe = require("stripe")(process.env.PAYMENT_TEST_KEY)
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();
const port = process.env.PORT || 5000;

// app.use(cors());
const corsConfig = {
  origin: "*",
  credentials: true,
  methods: ["GET","POST","PUT","DELETE"]
}
app.use(cors(corsConfig))
app.options("",cors(corsConfig))

app.use(express.json());

const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res.status(401).send({ error: true, message: 'Unauthorized access' });
  }
  const token = authorization.split(' ')[1];

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ error: true, message: 'Unauthorized access' })
    }
    req.decoded = decoded;
    next();
  })
}

const uri = `mongodb://${process.env.DB_USER}:${process.env.DB_PASS}@ac-lkphvzo-shard-00-00.dysamrx.mongodb.net:27017,ac-lkphvzo-shard-00-01.dysamrx.mongodb.net:27017,ac-lkphvzo-shard-00-02.dysamrx.mongodb.net:27017/?ssl=true&replicaSet=atlas-11u6ye-shard-0&authSource=admin&retryWrites=true&w=majority`

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const usersCollection = client.db("encoremusic").collection("userCollection")
    const classCollection = client.db("encoremusic").collection("classCollection")
    const instructorCollection = client.db("encoremusic").collection("instructorCollection")
    const selectedClassesCollection = client.db("encoremusic").collection("selectedClasses")
    const paymentCollection = client.db("encoremusic").collection("paymentCollection")
    
    app.post('/jwt', (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })

      res.send({ token })
    })

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email }
      const user = await usersCollection.findOne(query);
      if (user?.role !== 'admin') {
        return res.status(403).send({ error: true, message: 'forbidden access' });
      }
      next();
    }

    const verifyInstructor = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email }
      const user = await usersCollection.findOne(query);
      if (user?.role !== 'instructor') {
        return res.status(403).send({ error: true, message: 'forbidden access' });
      }
      next();
    }

    // User api
    app.get('/users-role', verifyJWT,  async (req, res) => {
      const email = req.query.email;
      if (req.decoded.email !== email) {
        res.send({ userRole: null })
      }
      const query = { email: email }
      const user = await usersCollection.findOne(query);
      const result = { userRole: user?.role }
      res.send(result);
    });

    app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
      const query = {}
      const descendingSort = {
        sort: {role: -1}
      }
      const result = await usersCollection.find(query, descendingSort).toArray();
      res.send(result);
    });

    app.post('/users', async (req, res) => {
      const user = req.body;
      const query = { email: user.email }
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: 'user already exists' })
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.put("/manageUsers/:id", async(req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const user = req.body;
      const updateRole = {
        $set: {
          role: user.role
        }
      }
      const updateResult = await usersCollection.updateOne(filter, updateRole);

      const insertResult = await instructorCollection.insertOne(user)
      res.send({updateResult, insertResult});
    })

    // Class Api
    app.get("/classes", async(req, res) => {
      let query = {
        status: "approved"
      };
      const descendingSort = {
        sort: {total_enrolled_students: -1}
      }
      const result = await classCollection.find(query, descendingSort).toArray();
      res.send(result);
    })

    app.get("/myClasses", verifyJWT, verifyInstructor, async(req, res) => {
      const email = req.query.email;
      if (!email) {
        res.send([]);
      }
      const decodedEmail = req.decoded.email;
      if (email !== decodedEmail) {
        return res.status(403).send({ error: true, message: 'forbidden access' })
      }
      const query = { instructor_email: email };
      const result = await classCollection.find(query).toArray();
      res.send(result);
    })

    app.put("/myClasses/:id", async(req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const classData = req.body;
      const updateClass = {
        $set: {
          image: classData.image,
          total_seats: classData.total_seats,
          price: classData.price,
        }
      }
      const result = await classCollection.updateOne(filter, updateClass)
      res.send(result)
    })

    app.get("/manageClasses", verifyJWT, verifyAdmin, async(req, res) => {
      const query = {}
      const descendingSort = {
        sort: {status: -1}
      }
      const result = await classCollection.find(query, descendingSort).toArray();
      res.send(result);
    })

    app.put("/manageClasses/:id", verifyJWT, verifyAdmin, async(req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const status = req.body;
      const updateStatus = {
        $set: {
          status: status.status
        }
      }
      const result = await classCollection.updateOne(filter, updateStatus)
      res.send(result)
    })

    app.put("/feedback/:id", async(req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const feedback = req.body;
      const options = { upsert: true };
      const updateFeedback = {
        $set: {
          feedback: feedback.feedback
        }
      }
      const result = await classCollection.updateOne(filter, updateFeedback, options)
      res.send(result)
    })

    app.get("/classes/:id", async(req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const result = await classCollection.findOne(filter)
      res.send(result)
    })

    app.post("/classes", verifyJWT, async(req, res) => {
      const classItem = req.body;
      const result = await selectedClassesCollection.insertOne(classItem)
      res.send(result)
    })

    app.delete("/classes/:id", verifyJWT, async(req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await selectedClassesCollection.deleteOne(query)
      res.send(result);
    })

    app.get("/selectedClasses", verifyJWT, async(req, res) => {
      const email = req.query.email;
      if (!email) {
        res.send([]);
      }
      const decodedEmail = req.decoded.email;
      if (email !== decodedEmail) {
        return res.status(403).send({ error: true, message: 'forbidden access' })
      }
      const query = { user_email: email };
      const result = await selectedClassesCollection.find(query).toArray();
      res.send(result);
    })

    app.get("/enrolledClasses", verifyJWT, async(req, res) => {
      const email = req.query.email;
      if (!email) {
        res.send([]);
      }
      const decodedEmail = req.decoded.email;
      if (email !== decodedEmail) {
        return res.status(403).send({ error: true, message: 'forbidden access' })
      }
      const query = { user_email: email };
      const result = await paymentCollection.find(query).toArray();
      res.send(result);
    })

    app.post("/add-class", verifyJWT, verifyInstructor, async(req, res) => {
      const classItem = req.body;
      const result = await classCollection.insertOne(classItem)
      res.send(result);
    })

    // Payment Api
    app.get("/payment/:id", async(req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await selectedClassesCollection.findOne(query)
      res.send(result);
    })

    app.post('/create-payment-intent', verifyJWT, async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card']
      });

      res.send({
        clientSecret: paymentIntent.client_secret
      })
    })

    app.post('/payments', verifyJWT, async (req, res) => {
      const payment = req.body;
      const insertResult = await paymentCollection.insertOne(payment);
      console.log(payment)

      const query = { _id: new ObjectId(payment.itemId) }
      const deleteResult = await selectedClassesCollection.deleteOne(query)

      const id = payment.itemId
      const filter = { _id: new ObjectId(id) };
      const increment = {
        $inc: {
          total_enrolled_students: 1
        }
      }
      const updateResult = await classCollection.updateOne(filter, increment)

      res.send({ insertResult, deleteResult, updateResult });
    })

    app.get("/payment-history", verifyJWT, async(req, res) => {
      const email = req.query.email;
      if (!email) {
        res.send([]);
      }
      const decodedEmail = req.decoded.email;
      if (email !== decodedEmail) {
        return res.status(403).send({ error: true, message: 'forbidden access' })
      }
      const query = { user_email: email };
      const descendingSort = {
        sort: {date: -1}
      }
      const result = await paymentCollection.find(query, descendingSort).toArray();
      res.send(result);
    })

    // Instructor Api
    app.get("/instructors", async(req, res) => {
      const result = await instructorCollection.find().toArray();
      res.send(result);
    })

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get("/", (req, res) => {
    res.send("Encore Music Academy server is running");
  })
  
  app.listen(port, () => {
    console.log(`Encore Music Academy server is running on port: ${port}`);
  })