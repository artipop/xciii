import {IntlShape} from '../../intl'

import {PropertyType, PropertyTypeEnum, FilterValueType} from '../types'

import Person from './person'

export default class PersonProperty extends PropertyType {
    Editor = Person
    name = 'Person'
    type = 'person' as PropertyTypeEnum
    displayName = (intl: IntlShape) => intl.formatMessage({id: 'PropertyType.Person', defaultMessage: 'Person'})
    canFilter = true
    filterValueType = 'person' as FilterValueType
    canGroup = true
}
