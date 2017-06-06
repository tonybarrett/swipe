import { Component, ViewChild, ViewChildren, QueryList } from '@angular/core';
import { NavController, Platform, NavParams, LoadingController, AlertController, ToastController } from 'ionic-angular';
import { Http, Headers, RequestOptions } from '@angular/http';
import 'rxjs/add/operator/map';
import { StackConfig, Stack, Card, ThrowEvent, DragEvent, SwingStackComponent, SwingCardComponent, Direction } from 'angular2-swing';
import * as PouchDB from 'pouchdb';
import * as PouchSQLite from 'pouchdb-adapter-cordova-sqlite';

import { TabsPage } from '../tabs/tabs';

import { SettingsProvider } from '../../providers/settings';
import { NetworkStatusProvider } from '../../providers/networkStatus';
import { PouchDBProvider } from '../../providers/pouchDB';

@Component({
  selector: 'page-ingredientsPage',
  templateUrl: 'ingredientsPage.html'
})
export class IngredientsPage {

  @ViewChild('myswing1') swingStack: SwingStackComponent;
  @ViewChildren('mycards1') swingCards: QueryList<SwingCardComponent>;

  allIngredients: Array<any>;
  ingredients: Array<any>;
  acceptedIngredients: Array<any> = [];
  rejectedIngredients: Array<any> = [];
  likedIngredients: Array<any> = [];
  dislikedIngredients: Array<any> = [];
  likedIngredientIds: Array<number> = [];
  dislikedIngredientIds: Array<number> = [];
  stackConfig: StackConfig;
  numLiked: number = 0;
  numDisliked: number = 0;
  ingredientId: string;
  ingredientName: string;
  pouch: any;
  passedId: number;
  numIngredientCategories: number;
  category: string;
  data: any = [];
  storedLiked: any = [];
  storedDisliked: any = [];
  backendURL: string;
  networkStatus: boolean;
  accessToken: string;
  ingredientsSpinner = this.loadingCtrl.create({
    content: "Menu Box is loading. Please wait…",
    cssClass: 'shadowedLoader'
  });

  constructor(
    public settingsProvider: SettingsProvider,
    public networkStatusProvider: NetworkStatusProvider,
    public pouchBDProvider: PouchDBProvider,
    public http: Http,
    public navParams: NavParams,
    public navCtrl: NavController,
    public toastCtrl: ToastController,
    public loadingCtrl: LoadingController,
    public alertCtrl: AlertController,
    public platform: Platform,
  )
  {
    if (!this.platform.is('cordova')) {  // Browser
      this.pouch = new PouchDB('menuBox', { adapter: 'websql' });
    } else {    // Mobile
      PouchDB.plugin(PouchSQLite);
      this.pouch = new PouchDB('menuBox', { adapter: 'cordova-sqlite', location: 'default' });
    }
    this.stackConfig = {
      allowedDirections: [Direction.LEFT, Direction.RIGHT],
      throwOutConfidence: (offsetX, offsetY, element) => {
        return Math.min(Math.max(Math.abs(offsetX) / (element.offsetWidth / 1.7), Math.abs(offsetY) / (element.offsetHeight / 2)), 1);
      },
      throwOutDistance: (d) => {
        return 800;
      }
    }
  }

  ngAfterViewInit() {
    this.swingStack.throwoutleft.subscribe(
      (event: ThrowEvent) => this.accepted(event)
    );

    this.swingStack.throwoutright.subscribe(
      (event: ThrowEvent) => this.rejected(event)
    );
  }

  onThrowOut(event: ThrowEvent) {
    console.log('Direction -', event.throwDirection);
  }

  ionViewDidLoad() {
    this.backendURL = this.settingsProvider.backendURL;
    this.networkStatus = this.networkStatusProvider.networkStatus();
  // Use the passed index to get the correct object from pouch
    this.passedId = this.navParams.get('ingredientCategoryId');
    if (this.passedId === -1) {
      // First time in this page so download the ingredients
      this.pouch.get('accessToken')
        .then(doc => {
          this.accessToken = doc.value;
          this.getAllIngredientsFromServer();
        })
        .catch(err => {
          this.pouchBDProvider.localStorageError('access token', err);
        }
      )
    } else {
      this.pouch.get('accessToken')
        .then(doc => {
          this.accessToken = doc.value;
          this.getIngredientsFromPouch();
        })
        .catch(err => {
          this.pouchBDProvider.localStorageError('access token', err);
        }
      )
    }
  }

  accepted(event: ThrowEvent) {
    this.numLiked++;
    this.ingredientId = event.target.getAttribute('data-id');
    this.putInCorrectArray('accepted', this.ingredientId);
  }

  rejected(event: ThrowEvent) {
    this.numDisliked++;
    this.ingredientId = event.target.getAttribute('data-id');
    this.putInCorrectArray('rejected', this.ingredientId);
  }

  putInCorrectArray(arrayToUse, ingredientId) {
    if (arrayToUse === 'accepted') {
      this.acceptedIngredients.push(ingredientId)
    } else {
      this.rejectedIngredients.push(ingredientId)
    }
    if ((this.numDisliked + this.numLiked) === (this.ingredients.length)) {
      // No ingredients left to choose
      this.saveIngredients();
      this.pouch.get('numIngredientCategories')
        .then(doc => {
          this.numIngredientCategories = doc.value;
          if (this.passedId === this.numIngredientCategories) {
            // All ingredients selected (or not)
            this.sendIngredients();
          } else {
            this.navCtrl.setRoot(IngredientsPage, {
              ingredientCategoryId: this.passedId + 1
            })
          }
        })
        .catch(err => {
          this.pouchBDProvider.localStorageError('numIngredientCategories', err);
        }
      )
    }
  }

  saveIngredients() {
    // Save the liked ones first, then the disliked ones
    // Does it this way due to the way JS works (or doesn't)
    this.data = {
      category: this.category,
      ingredients: this.acceptedIngredients
    }
    this.pouch.get('likedIngredients')
      .then(doc => {
        this.storedLiked = doc.value;
        this.storedLiked.push(this.data);
        this.pouch.put({
          _id: 'likedIngredients',
          _rev: doc._rev,
          value: this.storedLiked
        });
        this.saveDislikedIngredients();
      })
      .catch(err => {
        if (err.status === 404) { // Not There
          this.storedLiked.push(this.data);
          this.pouch.put({
            _id: 'likedIngredients',
            value: this.storedLiked
          });
          this.saveDislikedIngredients();
          //
      } else {
          this.pouchBDProvider.localStorageError('liked ingredients', err);
        }
      }
    )
  }

  saveDislikedIngredients() {
    this.data = {
      category: this.category,
      ingredients: this.rejectedIngredients
    }
    this.pouch.get('dislikedIngredients')
      .then(doc => {
        this.storedDisliked = doc.value;
        this.storedDisliked.push(this.data);
        this.pouch.put({
          _id: 'dislikedIngredients',
          _rev: doc._rev,
          value: this.storedDisliked
        });
      })
      .catch(err => {
        if (err.status === 404) { // Not There
          this.storedDisliked.push(this.data);
          this.pouch.put({
            _id: 'dislikedIngredients',
            value: this.storedDisliked
          });
        } else {
          this.pouchBDProvider.localStorageError('disliked ingredients', err);
        }
      }
    )
  }

  getIngredientsFromPouch() {
    this.pouch.get('ingredients')
      .then(doc => {
        this.allIngredients = doc.value;
        this.ingredients = this.allIngredients[this.passedId].ingredients
      })
      .catch(err => {
        this.pouchBDProvider.localStorageError('ingredients', err);
      }
    )
  }

  getAllIngredientsFromServer() {
    // This is the bit which pulls in all ingredients
    if (this.networkStatus === true) {
      let headers = new Headers({ 'Authorization': 'Bearer ' + this.accessToken });
      let options = new RequestOptions({ headers: headers });
      this.http.get(this.backendURL + 'initial-ingredients', options)
        .map(function (res) { // Change the result object into something more useful.
          return res.json(); // 'Returning' this changes the response body to JSON
        })
        .subscribe(data => { // because of the map function, this gets passed the 'body' as parsed JSON
          this.allIngredients = data;
          // persist this to local storage
          this.saveAllIngredients();
          // and then run this page again with a parameter 'of 0
          this.passedId++;
          this.navCtrl.setRoot(IngredientsPage, {
            ingredientCategoryId: this.passedId
          });
        }
      ),
      error => {
        let databaseErrorAlert = this.alertCtrl.create({
            title: 'Error communicating with server!',
            subTitle: 'Note error and contact head office - ' + JSON.parse(error._body),
            cssClass: 'shadowedAlert errorDialog',
            buttons: [
              {
                text: 'OK',
                cssClass: 'primaryChoice errorButton',
              }
            ]
          })
        this.ingredientsSpinner.dismiss();
        databaseErrorAlert.present();
        console.log(JSON.parse(error._body), ' - error communicating with server');
      }
    } else {
      let networkAlert = this.alertCtrl.create({
        title: 'Network Unvailable!',
        subTitle: 'There is no internet connection. Please contact you line manager for instructions.',
        cssClass: 'shadowedAlert errorDialog',
        buttons: [
          {
            text: 'OK',
            cssClass: 'primaryChoice errorButton',
          }
        ]
        })
      this.ingredientsSpinner.dismiss();
      networkAlert.present();
    }
  }

  saveAllIngredients() {
    this.pouch.get('ingredients')
      .then(doc => {
        this.pouch.put({
          _id: 'ingredients',
          _rev: doc._rev,
          value: this.allIngredients
        });
        this.saveNumIngredientCategories();
    })
      .catch(err => {
        if (err.status === 404) { // Not There
          this.pouch.put({
            _id: 'ingredients',
            value: this.allIngredients
          });
          this.saveNumIngredientCategories();
        } else {
          this.pouchBDProvider.localStorageError('ingredients', err);
        }
      }
    )
  }

  saveNumIngredientCategories() {
    this.numIngredientCategories = this.allIngredients.length - 1;
    this.pouch.get('numIngredientCategories')
      .then(doc => {
        this.pouch.put({
          _id: 'numIngredientCategories',
          _rev: doc._rev,
          value: this.numIngredientCategories
        });
      })
      .catch(err => {
        if (err.status === 404) { // Not There
          this.pouch.put({
            _id: 'numIngredientCategories',
            value: this.numIngredientCategories
          });
        } else {
          this.pouchBDProvider.localStorageError('number of ingredient categories', err);
        }
      }
    )
  }

  sendIngredients() {
    // Grab the 'liked' and disliked pouches and put into local variables
    this.pouch.get('likedIngredients')
      .then(doc => {
        this.likedIngredients = doc.value;
        this.pouch.get('dislikedIngredients')
          .then(doc => {
            this.dislikedIngredients = doc.value;
            this.createIdArrays();
          })
          .catch(err => {
            this.pouchBDProvider.localStorageError('access token', err);
          }
        )
      })
      .catch(err => {
        this.pouchBDProvider.localStorageError('access token', err);
      }
    )
  }

  createIdArrays() {
    let sendSelectedIngredientsSpinner = this.loadingCtrl.create({
      content: "Uploading selection. Please wait...",
      cssClass: 'shadowedLoader'
    });
    let networkUnavailableAlert = this.alertCtrl.create({
      title: 'Network Unvailable!',
      subTitle: 'There is no internet connection. Please contact you line manager for instructions.',
      cssClass: 'shadowedAlert errorDialog',
      buttons: [
        {
          text: 'OK',
          cssClass: 'primaryChoice errorButton',
        }
      ]
    });
    let ingredientsToast: any = this.toastCtrl.create({
      message: 'Super! Your ingredient choices have been stored, now choose a recipe',
      duration: 3000,
      position: 'bottom',
      cssClass: 'toast'
    });
    sendSelectedIngredientsSpinner.present();
    for (let loop = 0; loop < this.likedIngredients.length; loop++) {
      for (let loop2 = 0; loop2 < this.likedIngredients[loop].ingredients.length; loop2++) {
        this.likedIngredientIds.push(this.likedIngredients[loop].ingredients[loop2]);
      }
    }
    for (let loop = 0; loop < this.dislikedIngredients.length; loop++) {
      for (let loop2 = 0; loop2 < this.dislikedIngredients[loop].ingredients.length; loop2++) {
        this.dislikedIngredientIds.push(this.dislikedIngredients[loop].ingredients[loop2]);
      }
    }
    this.networkStatus = this.networkStatusProvider.networkStatus();
    if (this.networkStatus === true) {
      let postData = {
          likes: this.likedIngredientIds,
          dislikes: this.dislikedIngredientIds
        }
console.log('ingredients before sending to API -', postData);
      let headers = new Headers({ 'Authorization': 'Bearer ' + this.accessToken });
      let options = new RequestOptions({ headers: headers });
      this.http.post(this.backendURL + 'ingredient-preferences/bulk', postData, options)
        .map(function (res) { // Change the result object into something more useful.
          return res.json(); // 'Returning' this changes the response body to JSON
        })
        .subscribe(data => { // because of the map function, this gets passed the 'body' as parsed JSON
          this.removeFromPouch();
          sendSelectedIngredientsSpinner.dismiss();
          ingredientsToast.present();
          this.navCtrl.setRoot(TabsPage);
        }),
        error => {
          let databaseErrorAlert = this.alertCtrl.create({
              title: 'Error communicating with server!',
              subTitle: 'Note error and contact head office - ' + JSON.parse(error._body),
              cssClass: 'shadowedAlert errorDialog',
              buttons: [
                {
                  text: 'OK',
                  cssClass: 'primaryChoice errorButton',
                }
              ]
          });
          sendSelectedIngredientsSpinner.dismiss();
          databaseErrorAlert.present();
          console.log(JSON.parse(error._body), ' - error communicating with server');
        }
      } else {
        sendSelectedIngredientsSpinner.dismiss();
        networkUnavailableAlert.present();
      }
  }

  removeFromPouch() {
    this.pouch.get('ingredients')
      .then(doc => {
        return this.pouch.remove(doc);
      })
      .catch(err => {
        if (err.status === 404) {
          // does not exist
        } else {
          this.pouchBDProvider.localStorageError('ingredients', err);
        }
      }
    )
    this.pouch.get('numIngredientCategories')
      .then(doc => {
        return this.pouch.remove(doc);
      })
      .catch(err => {
        if (err.status === 404) {
          // does not exist
        } else {
          this.pouchBDProvider.localStorageError('highest ingredient category', err);
        }
      }
    )
    this.pouch.get('likedIngredients')
      .then(doc => {
        return this.pouch.remove(doc);
      })
      .catch(err => {
        if (err.status === 404) {
          // does not exist
        } else {
          this.pouchBDProvider.localStorageError('liked ingredients', err);
        }
      }
    )
    this.pouch.get('dislikedIngredients')
      .then(doc => {
        return this.pouch.remove(doc);
      })
      .catch(err => {
        if (err.status === 404) {
          // does not exist
        } else {
          this.pouchBDProvider.localStorageError('disliked ingredients', err);
        }
      }
    )
  }

}
